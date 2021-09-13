const iotBase = require('./iotBase');
const fs = require('fs');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const _ = require('lodash');
const Joi = require('joi');
const P = require('bluebird');
const keythereum = require("keythereum");
const axios = require('axios');
const publicIp = require("public-ip");
const si = require('systeminformation');
const os = require('os');
const semver = require('semver');
const makedirp = require('mkdirp');
const request = require('request');
const progress = require('request-progress');
const curl = require("curl");

const tar = require('tar');

const upConfig = require('../config').update;
// const disklayout = require('../config').disklayout
const disklayout = require(`${process.cwd()}/config.json`).disklayout;
const {execSync} = require('child_process');
const udev = require("udev");
const Config = require(`${process.cwd()}/config.json`);

const schema = {
    password: Joi.string(),
    encryptKey:Joi.string(),
    //keyObject: Joi.object(),
    ip: Joi.string(),
    port: Joi.number().integer(),
    diskInfo: Joi.object(),
};

const schema2 = {
    newPassword: Joi.string(),
    oldPassword: Joi.string(),
    encryptKey:Joi.string()
};

const crypto = require('crypto');

function aesEncrypt(data, key) {
    const cipher = crypto.createCipher('aes192', key);
    let crypted = cipher.update(data, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
}

function aesDecrypt(encrypted, key) {
    const decipher = crypto.createDecipher('aes192', key);
    let decrypted = decipher.update(encrypted, 'hex');
    decrypted = Buffer.concat([decrypted,decipher.final()]) ;
    return decrypted;
}
function doExecSync(param){
    try {
        return execSync(param)
    }catch (e) {
        console.log(e.Error || e.message || e)
    }
}

class ESwarm extends iotBase {
    constructor(gw) {
        super('eSwarm',gw,{isApp:true,num:'01',name:'eswarm'});
        this.curDir = process.cwd();
        this.toState = "Stop"
        this.isDiskOn = true;

        this.updateAttr("state", "stop");
        this.updateAttr('status',0);
        this.updateAttr("config", {});

        this.diskMonitor.on('add', (device) => {
            if (this.attributes.config && this.attributes.config.diskInfo && this.attributes.config.diskInfo.uuid) {
                let useingDevice = this.attributes.config.diskInfo.uuid
                if (useingDevice && device.DEVTYPE == 'partition' && device.ID_FS_UUID == useingDevice) {
                    this.startup()
                }
            }
        });

        setInterval(() => {
            this.checkService();
            this.getStatus();
            if (this.toState == "online") {
                //查询外网IP，如果IP变了，重启eswarm
                //检测到磁盘没有容量，磁盘没有插入，停止swarm;
                let isStop = false;
                if (disklayout != "v3") {
                    let diskSize = this.gateway.iots.sysInfo.attributes.diskSize;
                    if (_.toNumber(diskSize) == 0){
                        console.log('sysInfo检测磁盘没有插入');
                        this.isDiskOn = false;
                        isStop = true;
                    }
                    //检查磁盘是否挂载上，没有挂载上则不启动swarm;
                    let checkResult = null;
                    if (disklayout  === "v2"){
                        checkResult = doExecSync(`sudo mount -l |grep /mnt/eswarm`);
                    } else{
                        checkResult = doExecSync(`sudo mount -l |grep /mnt/${this.attributes.config.diskInfo.uuid}`);
                    }
                    //没有挂载信息则挂载不成功
                    if (!checkResult) {
                        console.log('磁盘挂载不成功');
                        this.isDiskOn = false;
                        isStop = true;
                    }
                    //有挂载信息检测磁盘是否可用
                    let checkResult2 = null;
                    if (disklayout  === "v2"){
                        checkResult2 = doExecSync(`sudo lvscan |grep eswarm`);
                        if (!checkResult2) {
                            console.log('磁盘没有插入');
                            this.isDiskOn = false;
                            isStop = true;
                        }
                    }
                }

                if (isStop){
                    this.stop();
                } else{
                    return publicIp.v4({timeout: 1000}).then((ip)=>{
                        if (this.attributes.config.ip != ip) {
                            //将新IP保存到es.json里
                            let cPath = path.join(process.cwd(), "es.json");
                            if (fs.existsSync(cPath)) {
                                let esData = fs.readFileSync(cPath);
                                let esJson = JSON.parse(esData.toString())
                                esJson['ip'] = ip;
                                fs.writeFileSync(cPath, JSON.stringify(esJson));
                            }
                            return P.resolve(true);
                        }
                        return P.resolve(false);
                    }).catch(()=>{
                        return P.resolve(false);
                    }).then((startup)=>{
                        if(startup || (!this.process && !this.onStarting)) {
                            this.startup();
                        }
                    });
                }
            } else {
                if (this.process) {
                    this.stop()
                }
            }
        }, 60000)

    }

    /**
     * 检查service.json,判断启动还是停止
     */
    checkService(){
        if (!this.gateway.serviceJson) {
            this.stop();
            return;
        }
        let eswarmConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};
        // if (!eswarmConfig) {
        //     this.stop();
        //     return;
        // }
        this.updateAttr('require',eswarmConfig.active);
        if (eswarmConfig.active && this.attributes.state == "stop") {
            this.start();
            return;
        }
        if (!eswarmConfig.active && this.attributes.state != "stop") {
            this.stop();
            return;
        }
    }

    /**
     * 启动eswarm
     */
    start(){
        if(!this.onStarting){
            this.onStarting = true
            this.stop().then(()=>{
                this.toState = "online"
                //this.getVersion();
                //this.check();
                this.getPeer = setInterval(()=>{
                    this.getPeerCount();
                    //this.getStatus();
                }, 60000);
                this.updateAttr("state", "init");
            }).then(this.checkEsjsonAndBzzacount.bind(this))
                .then(this.initConfig.bind(this)).then((isOk) => {
                if (isOk) {
                    return new P((reslove)=>{
                        setTimeout(()=>{
                            reslove()
                        },15000)
                    }).then(()=>{
                        return this.startSwarm();
                    })
                } else {
                    this.updateAttr("state", "stop")
                }
                return P.resolve({});
            }).finally(()=>{
                this.onStarting = false
            })

        }
    }
    // /**
    //  * 获取eswarm的outerIp和outerPort
    //  * @returns {boolean}
    //  */
    // getOuterPortAndOuterIp(){
    //     let outerPortStatus = false;
    //     let nodePath =  path.join('/dev/shm/nodeinfo');
    //     let outerPort = null;
    //     let outerIp = null;
    //     if (fs.existsSync(nodePath)) {
    //         let enode = fs.readFileSync(nodePath).toString();
    //         if (enode) {
    //             let enodeFront = enode.split('?')[0];
    //             if (enodeFront) {
    //                 outerPort = enodeFront.split(':')[2];
    //                 if (outerPort) {
    //                     this.updateAttr('outerPort',outerPort);
    //                     outerIp = enodeFront.split(':')[1].split('@')[1];
    //                     this.updateAttr('outerIp',outerIp);
    //                 }
    //             }
    //         }
    //     }
    //     // //eswarm启动情况下显示eswarm的outerPort，outerIp；
    //     // //eswarm不启动显示矿机outerIp，随即端口；
    //     // if (!outerPort){
    //     //     outerPort = Math.floor(Math.random() * 50000) + '';
    //     //     this.updateAttr('outerPort',outerPort);
    //     // }
    //     // //如果两个方法outerIp相同，可以全部采用下面方法检测outerIp，防止eswarm启动生成/dev/shm/nodeinfo，后又一直关闭不更新？？？
    //     // if (!outerIp) {
    //     //     publicIp.v4({timeout: 1000}).then((ip)=>{
    //     //         outerIp = ip;
    //     //         this.updateAttr('outerIp',outerIp);
    //     //     })
    //     // }
    // }

    /**
     * 获取eswarm连接状态；this.attributes.peerCount.Light > 10 即正常；
     *
     */
    getStatus(){
        let eswarmConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};

        if (eswarmConfig && eswarmConfig.active) {
            if (this.attributes.state == 'start' && this.attributes.peerCount && this.attributes.peerCount.Light && this.attributes.peerCount.Light > 1) {
                this.updateAttr('status',0);
            }else{
                this.updateAttr('status',1);
            }
        }else{
            if (this.attributes.state == 'start') {
                this.updateAttr('status',1);
            }else{
                this.updateAttr('status',0);
            }
        }
    }

    stop() {
        if (this.process) {
            this.process.kill("SIGKILL");
            // doExecSync(`ps -ef |grep eswarm |awk '{print $2}' | xargs sudo kill -9`)
            doExecSync(`kill -9 ${this.process.pid}`)
            this.process = null;
            this.toState = "offline"
        }
        if (this.getPeer) {
            clearInterval(this.getPeer)
        }
        return new P((reslove)=>{
            setTimeout(()=>{
                reslove()
            },1000)
        })
    }

    startup() {
        this.getVersion();
        this.stop();
        setInterval(()=>{
            this.getCache();
        },_.toNumber(Config.netInfoIntervalTime || '300000'));
        // this.getOuterPortAndOuterIp();
        // setInterval(()=>{
        //     this.getOuterPortAndOuterIp();
        // }, _.toNumber(Config.netInfoIntervalTime || '300000'));
    }

    getPeerCount() {
        if (this.attributes['state'] == 'start') {
            axios.get("http://localhost:8500/nodes:/").then((response) => {
                // console.log(response.data);
                if (response.status == 200) {
                    this.updateAttr("peerCount", response.data)
                } else {
                    this.updateAttr("peerCount", {Full: 0, Light: 0})
                }
            }).catch((error) => {
                this.updateAttr("peerCount", {Full: 0, Light: 0})
            });
        } else {
            this.updateAttr("peerCount", {Full: 0, Light: 0})
        }
    }


    initConfig() {
        let isOK = true;
        this.args = {};
        let config = {};
        let esConfig = {}
        //读取es.json文件，生成esConfig对象
        let cPath = path.join(process.cwd(), "es.json");
        if (fs.existsSync(cPath)) {
            let data
            try{
                data = fs.readFileSync(cPath);
            }catch(e){
                console.log('es.json文件读取不了：',e)
                fs.unlinkSync(cPath);
                isOK = false
                return P.resolve(isOK)
            }
            try {
                esConfig = JSON.parse(data.toString())
            } catch (e) {
                console.log('JSON文件转换不了：',e)
                fs.unlinkSync(cPath);
                isOK = false
                return P.resolve(isOK)
            }
        }
        //读取default-config.json配置信息生成config,将es.json内容追加覆盖config
        //bootConfig:额外启动配置参数；在default-config.json配置，但跟es.json参数相同会被es.json覆盖
        let bootConfig = {}
        let defaultConfigPath = path.join(process.cwd(), 'default-config.json');
        if (fs.existsSync(defaultConfigPath)) {
            let data = fs.readFileSync(defaultConfigPath);
            try {
                config = JSON.parse(data.toString())
                _.each(esConfig,(esValue,esKey) =>{
                    config[esKey] = esValue
                })
                bootConfig = JSON.parse(data.toString());
            } catch (e) {
                console.log('文件合并有问题')
                isOK = false
                return P.resolve(isOK)
            }
        }else{
            config = esConfig;
        }
        return P.resolve().then(() => {
            if(disklayout  === "v3"){
                return P.resolve();
            }else if (disklayout  === "v2"){
                doExecSync(`sudo ${process.cwd()}/sh/chkeswarmfs.sh`)
            }else{
                doExecSync(`sudo umount ${config.diskInfo.mount}`)
                doExecSync(`sudo mount -tauto -orw -U ${config.diskInfo.uuid} /mnt/${config.diskInfo.uuid} || true`)
            }


        }).then(() =>{
            let dataDir = process.cwd();
            if (dataDir === "" || !fs.existsSync(dataDir)) {
                return P.reject()
            }
            this.args["--datadir"] = dataDir
            //
            if (disklayout ==="v3") {
                //判断是否有//mnt/data
                if (!this.checkPath('/mnt/data')){
                    return P.reject();
                }
                this.args["--store.path"] = "/mnt/data";
                // let mntDir = path.join("/mnt");
                // if (!fs.existsSync(mntDir)) {
                //     doExecSync(`sudo mkdir /mnt`);
                // }
                // let eswarmDir = path.join("/mnt/eswarm");
                // if (!fs.existsSync(eswarmDir)) {
                //     doExecSync(`sudo mkdir /mnt/eswarm`);
                // }
                // this.args["--store.path"] = "/mnt/eswarm";
            }else if (disklayout ==="v2"){
                this.args["--store.path"] = "/mnt/eswarm";
            }else {
                this.args["--store.path"] = (config.diskInfo && (config.diskInfo.mount || "/mnt/" + config.diskInfo.uuid)) || "";
            }
            return new Promise((resolve, reject) =>{
                let keyPath = path.join(dataDir, 'keystore');
                if (!fs.existsSync(keyPath)) {
                    try {
                        fs.mkdirSync(keyPath);
                        resolve()
                    } catch (e) {
                        //config.diskInfo.mount = "";
                        isOK = false;
                        reject()
                    }
                }else{
                    resolve()
                }
            })
        }).then(() => {
            this.args['--bzzaccount'] = config.bzzaccount;
            this.args['--password'] = config.password;
            if (config.bzznetworkid) {
                this.args['--bzznetworkid'] = config.bzznetworkid;
            }
            if (config.booturl) {
                this.args['--bootnodes.url'] = config.booturl;
            }
            if (config.reportinterval) {
                this.args['--reportinterval'] = config.reportinterval;
            }
            if (disklayout ==="v3") {
                // 判断/mnt/eswarm是否是挂载点,如果不是则绑定/mnt/data和/mnt/eswarm
                // execSync(`mountpoint -q /mnt/eswarm`);
                // let isMountpoint = execSync(`echo $?`).toString();
                // if (isMountpoint == '1'){
                //     execSync(`mount --bind /mnt/data /mnt/eswarm`);
                // }
                //new
                // let isMountpoint = null;
                // exec(`mountpoint /mnt/eswarm`,(err,stdout,stderr)=>{
                //     if (err){
                //         console.log(err);
                //     }
                //     if (stdout){
                //         isMountpoint = /is a mountpoint/.test(stdout)
                //     }
                // })
                // if (isMountpoint!= null && !isMountpoint){
                //     execSync(`mount --bind /mnt/data /mnt/eswarm`);
                // }

                let tolDiskSize = execSync(`df -l /mnt/data |awk '{if(NR==2){print $2}}'`).toString();
                //判断磁盘大小是否能够混跑
                if (_.toNumber(tolDiskSize) <= _.toNumber(Config.aqyStoreSize || 0)*1024*1024) {
                    console.log('磁盘空间过小，不能混跑');
                    return P.reject();
                }
                //总磁盘大小扣除aqy占有剩余给eswarm
                let eswarmSize = _.toNumber(tolDiskSize) - _.toNumber(Config.aqyStoreSize || 0)*1024*1024;
                this.args['--store.size'] = (_.toNumber(eswarmSize)*1024 * 0.9 /1024 /256).toFixed(0);
            }else if (disklayout ==="v2") {
                let diskSize = execSync(`df -l /dev/mapper/vgeswarm-eswarm |awk '{if(NR==2){print $2}}'`).toString();
                this.args['--store.size'] = (_.toNumber(diskSize)*1024 * 0.9 /1024 /256).toFixed(0);
            }else{
                if(config.diskInfo.size){
                    this.args['--store.size'] = (config.diskInfo.size * 0.9 /1024 /256).toFixed(0);
                }
            }

        }).catch((e) => {
            config.bzzaccount = "";
            config.password = "";
            isOK = false
        }).then(() => {
            if (!_.isNumber(config['port'])) {
                config['port'] = Math.floor(Math.random() * 50000) + 2024;
                //将port保存到es.json里
                if (fs.existsSync(cPath)) {
                    let esjsonData = fs.readFileSync(cPath);
                    let esjsonConfig = JSON.parse(esjsonData.toString())
                    esjsonConfig['port'] = config['port'];
                    fs.writeFileSync(cPath, JSON.stringify(esjsonConfig));
                }
            }
            this.args['--port'] = config['port'];
            this.updateAttr('outerPort',config['port'].toString());

            this.args['--corsdomain'] = "*";
            //设置额外的启动参数
            _.each(bootConfig,(value,key)=>{
                let argkey = '--' + key;
                if (!this.args.hasOwnProperty(argkey)) {
                    this.args[argkey] = value;
                }
            })
        }).then(() => {
            return publicIp.v4({timeout: 1000}).then((ip)=>{
                config['ip'] = ip;
                return isOK;
            }).catch((e) => {
                console.log("error in get ip", e)
                return true;
            })

        }).finally(()=>{
            this.updateAttr('config', config);
        })
    }

    startSwarm() {
        let swarmPath = this.getSwarmPath();
        if (!fs.existsSync(swarmPath)) {
            this.updateAttr("state", "stop");
            return P.reject("no swarm");
        }
        this.updateAttr('startTime', new Date());
        let args = [];
        _.each(this.args, (v, k) => {
            args.push(k);
            args.push(v);
        });

        //启动时创建diskuuid.txt文件
        // let diskuuidPath = path.join(process.cwd(), "diskuuid.txt");
        // if (this.attributes.config && this.attributes.config.diskInfo && this.attributes.config.diskInfo.uuid) {
        //     fs.writeFileSync(diskuuidPath, this.attributes.config.diskInfo.uuid);
        // }

        this.process = spawn(swarmPath, args);
        this.addProcess(this.iotId,[this.process.pid]);
        this.updateAttr("state", "start");
        this.process.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        this.process.stderr.on('data', (data) => {
            console.log(data.toString());
        });

        this.process.on('close', (code) => {
            this.process = undefined
            this.updateAttr('state', 'stop');
            console.log('eswarm stop !!!');
        });
    }
    getPids(){
        let pids = [];
        if (this.process){
            pids.push(this.process.pid);
        }
        return pids;
    }
    //备份私钥到手机服务
    getKeyObject(password) {
        let pd = password['password']
        if(!pd){
            return P.reject('no password')
        }
        let keyObject = keythereum.importFromFile(this.attributes.config.bzzaccount,process.cwd())

        //密码恢复私钥再加密
        return new P((resolve, reject) => {
            try{
                let privateKey = keythereum.recover(pd, keyObject)
                resolve(privateKey)
            }catch(e){
                reject('密码错误')
            }
        })
        .then((privateKey) => {
            if (_.isError(privateKey)) {
                return P.reject({message: privateKey.message})
            } else {
                let encryptedKey = aesEncrypt(privateKey,pd)
                return encryptedKey
            }
        }).catch((reason) => {
            return P.reject(reason)
        })

    }
    //保存手机配置，并初始化的服务
    setConfig(options) {
        let result = Joi.validate(options, schema);
        if (result.error) {
            return P.reject(result.error);
        }
        let diskInfo = options.diskInfo
        //增加挂载点判断,防止系统自动挂载到错误路径
        let rightMount = path.join('/mnt/',diskInfo.uuid)
        if (diskInfo.mount && rightMount != diskInfo.mount) {
            doExecSync(`sudo umount ${diskInfo.mount}`)
            //doExecSync(`sudo mount -tauto -orw -U ${diskInfo.uuid} /mnt/${diskInfo.uuid} || true`)
            execSync(`sudo ${process.cwd()}/sh/importfs.sh ${diskInfo.name}`)
            execSync(`${process.cwd()}/sh/updatefs.sh ${diskInfo.name}`)
            diskInfo.mount = rightMount
        }
        let keyPath = path.join(process.cwd(), 'keystore');
        if (!fs.existsSync(keyPath)) {
            try{
                fs.mkdirSync(keyPath);
            }catch(e){
                return P.reject('创建keystore文件夹错误')
            }
        }
        //保存keyObject
        let option = {
            kdf: "pbkdf2",
            cipher: "aes-128-ctr",
            kdfparams: {
                c: 262144,
                dklen: 32,
                prf: "hmac-sha256"
            }
        };
        let privateKey
        try{
            privateKey = aesDecrypt(options.encryptKey,options.password)
        }catch(e){
            return P.reject('password is wrong')
        }

        let keyObject
        try{
            keyObject = keythereum.dump(options.password, privateKey, crypto.randomBytes(32), crypto.randomBytes(16), option);
        }
        catch (e) {
            return P.reject('can not create keyObjct')
        }
        this.saveKeyObject(keyObject,process.cwd())
            .catch((reason) => {
            return P.reject(reason)
        })

        //更新 update es.json
        //this.updateConfig({dataDir:option.dataDir, password:options.password, bzzaccount:keyObject.address})
        let config = {}
        config['diskInfo'] = diskInfo;
        config['password'] = options.password;
        config['bzzaccount'] = keyObject.address;
        if (!_.isNumber(options.port)) {
            config['port'] = Math.floor(Math.random() * 50000) + 2024
        }else{
            config['port'] = options.port;
        }
        let cPath = path.join(process.cwd(), "es.json");
        fs.writeFileSync(cPath, JSON.stringify(config));

        //初始化设置，并启动swarm
        this.startup();
        let diskInfojs = this.gateway.iots.diskInfo;
        diskInfojs.getInfo();
        return P.resolve()

    }
    //检查是否有es.json,如果没有则生成es.json;{bzzaccount,password,port}
    checkEsjsonAndBzzacount(){
        let esjsonpath = path.join(process.cwd(), "es.json");
        if (!fs.existsSync(esjsonpath)) {
            //创建私钥
            let params = { keyBytes: 32, ivBytes: 16 };
            let dk = keythereum.create(params);
            //创建keyObject
            let options = {
                kdf: "pbkdf2",
                cipher: "aes-128-ctr",
                kdfparams: {
                    c: 262144,
                    dklen: 32,
                    prf: "hmac-sha256"
                }
            };
            let password = '';
            for (let i = 0;i<6;i++){
                password += Math.floor(Math.random()*10);
            }
            let keyObject = keythereum.dump(password, dk.privateKey, dk.salt, dk.iv, options);
            //保存keyObject
            let dataDir = process.cwd();
            this.saveKeyObject(keyObject,dataDir);
            //保存password,bzzaccount;
            this.attributes.config['password'] = password;
            this.attributes.config['bzzaccount'] = keyObject.address;
            this.attributes.config['port'] = Math.floor(Math.random() * 50000) + 2024
            //生成es.json
            fs.writeFileSync(esjsonpath, JSON.stringify(this.attributes.config));
            console.log('check no es.json;create new es.json');
        }
    }

    updateConfig(attrs){
        let keys = Object.keys(attrs) ||[]
        let config = this.attributes['config'] || {}
        for ( let i = 0; i < keys.length ;i++){
            config[keys[i]] = attrs[keys[i]]
        }
        this.updateAttr('config',config,true)
        //save
        let cPath = path.join(process.cwd(), "es.json");
        let keyBackup = config['keyObject']
         config['keyObject'] = undefined;
        fs.writeFileSync(cPath, JSON.stringify(config));
        config['keyObject'] =keyBackup
    }
    //保存keyObject到指定路径的keystore
    saveKeyObject(keyObject,dataDir) {
        try {
            let keyPath = path.join(dataDir,'keystore');
            if (!fs.existsSync(keyPath)) {
                makedirp(keyPath);
            }
            if(keyObject){
                //需要删除目录下的所有的同类的
                doExecSync(`find ${keyPath} -name *${keyObject.address} -print0 | xargs  -0 rm -fr`);
                keythereum.exportToFile(keyObject, keyPath);
                return P.resolve();
            }else{
                return P.reject("KEY路径不存在");
            }
        } catch (e) {
            return P.reject(e);
        }
    }

    //修改密码服务
    changePassword(options) {
        let result = Joi.validate(options, schema2);
        if (result.error) {
            return P.reject(result.error);
        }

        let privateKey;
        let reOk = true;

        let bzzaccount = this.attributes.config.bzzaccount;
        //let dataDir = path.join(this.attributes.config.diskInfo.mount,'keystore')

        //验证旧密码是否正确
        let keyObject = keythereum.importFromFile(bzzaccount,process.cwd())
        try {
            privateKey = keythereum.recover(options.oldPassword, keyObject);
        } catch (e) {
            reOk = false;
        }
        if (!reOk) {
            return P.reject('旧密码错误!');
        }
        //通过传过来的加密私钥生成私钥
        try{
            privateKey = aesDecrypt(options.encryptKey,options.newPassword)
        }catch(e){
            return P.reject('new password is not fix private key')
        }

        let option = {
            kdf: 'pbkdf2',
            cipher: 'aes-128-ctr',
            kdfparams: {
                c: 262144,
                dklen: 32,
                prf: 'hmac-sha256'
            }
        };
        reOk = true;
        let newKeyObject;
        try {
            newKeyObject = keythereum.dump(options.newPassword, privateKey,  crypto.randomBytes(32), crypto.randomBytes(16), option)
        } catch (e) {
            reOk = false;
        }
        if (!reOk) {
            return P.reject('修改密码失败!');
        }

        let config = this.attributes['config'] || {}
        //保存keyObject
        this.saveKeyObject(newKeyObject,process.cwd())
        //更新属性
        config['password'] = options.newPassword;
        //保存es.json
        let cPath = path.join(process.cwd(), "es.json");
        fs.writeFileSync(cPath, JSON.stringify(config));
        //重启服务
        this.startup();
        //  let encryptedKey = aesEncrypt(privateKey,"MassKey@"+options.newPassword)
        // this.updateConfig({password:options.newPassword,keyObject:newKeyObject,encKey:encryptedKey})
        //  this.saveKeyObject()
        return P.resolve();

    }

    getSwarmPath() {
        let swarmPath = `${this.curDir}/cdsc/linux/eswarm`;
        if (os.type() == "Windows_NT") {
            swarmPath = `${this.curDir}/cdsc/win32/eswarm.exe`;
        }else if(os.type() == "Darwin"){
            swarmPath = `${this.curDir}/cdsc/macos/eswarm`;
        }
        return swarmPath;
    }

    getVersion() {
        let arg = ["--version"];
        let process = spawnSync(this.getSwarmPath(), arg);
        let verString = (process.stdout && process.stdout.toString()) || "";
        //let versions = verString.match(/eswarm version ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})-([a-zA-Z]*)(-([0-9a-fA-F]*))?/) || [];
        let versions = verString.match(/eswarm version ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})-([a-zA-Z]*)-([0-9a-fA-F]*)?/) || [];
        this.updateAttr("version", {
            value: versions[1] || "",
            meta: versions[2] || "",
            hash: versions[3] || ""
        })
    }
    getCache(){
        P.resolve().then(()=> {
            // let cache1 = execSync("du -s /mnt/data/rawchunks0.wt |awk '{print $1}'").toString();
            // let cache2 = execSync("du -s /mnt/eswarm/rawchunks0.wt |awk '{print $1}'").toString();
            // console.log('cache1:', cache1);
            // console.log('cache2:', cache2);
            // let cacheUseStr = cache1 || cache2;
            // console.log('cacheUseStr:', cacheUseStr);
            let cacheUse = 0;
            let cacheUseStr = execSync("du -s /mnt/data/rawchunks0.wt |awk '{print $1}'").toString() || execSync("du -s /mnt/eswarm/rawchunks0.wt |awk '{print $1}'").toString();
            if (cacheUseStr != "") {
                let cacheUseNum = Math.round(_.toNumber(cacheUseStr) / 1024 / 1024 * 100) / 100;
                if (!_.isNaN(cacheUseNum)) {
                    cacheUse = cacheUseNum;
                    //this.updateAttr("cache", cacheUse);
                    //console.log('cache:', this.attributes.cache);
                }
            }
            this.updateAttr("cache", cacheUse);
        })
    }
    // check() {
    //     let fileName = "";
    //     return P.resolve().then(si.osInfo).then(result => {
    //         let url = `${upConfig.url}update/${upConfig.channel || "stable"}`;
    //         fileName = `eswarm-${result.platform}-${result.arch}.tar.gz`;
    //         let params = {
    //             filename: fileName
    //         };
    //         this.updateAttr("upVersion", {filename: params.filename});
    //         return axios.get(url, {params})
    //     }).then(result => {
    //         let version = (this.attributes["version"] && this.attributes["version"].value) || "0.0.0";
    //         if (result.status == 200 && semver.lt(version, result.data.name)) {
    //             this.updateAttr("upVersion", {
    //                 value: result.data.name,
    //                 filename: fileName,
    //                 date: new Date(),
    //                 ...result.data
    //             });
    //         } else {
    //             this.updateAttr("upVersion", {date: new Date()})
    //         }
    //     }).catch(error => {
    //         this.updateAttr("upVersion", {error: '服务器无法访问!', date: new Date()});
    //         return P.reject("更新检查失败！")
    //     })
    // }


    //更新eswarm版本服务
    // update() {
    //     if (this.isUpdate) {
    //         return P.reject('正在升级！')
    //     }
    //     let swarmpath = path.join(this.getUpdatePath(),this.attributes["upVersion"].filename)
    //     this.downAndUp(swarmpath);
    //     return P.resolve({});
    // }
    // getUpdatePath(){
    //     let updatePath = `${this.curDir}/cdsc/linux`;
    //     if (os.type() == "Windows_NT") {
    //         updatePath = `${this.curDir}/cdsc/win32`;
    //     }else if(os.type() == "Darwin"){
    //         updatePath = `${this.curDir}/cdsc/macos`;
    //     }
    //     return updatePath;
    // }
    // downAndUp(downPath) {
    //     if (!this.attributes["upVersion"].url) {
    //         return;
    //     }
    //     let fileName = this.attributes["upVersion"].filename;
    //     return new P((resolve, reject) => {
    //         this.isUpdate = true;
    //         progress(request(this.attributes["upVersion"].url), {
    //             throttle: 1000,
    //             delay: 100,
    //         }).on('progress', (state) => {
    //             this.updateAttr("upVersion", {
    //                 percent: Math.ceil(state.percent * 100)
    //             });
    //         }).on('error', (err) => {
    //             reject(err);
    //         })
    //             .pipe(fs.createWriteStream(downPath))
    //             .on('finish', resolve)
    //     }).then(() => {
    //         return this.stop();
    //     }).then(() => {
    //         let dir = path.resolve(this.getSwarmPath(),'..');
    //         return tar.x({
    //             file: downPath,
    //             C: dir
    //         })
    //     }).then((result) => {
    //         this.isUpdate = false;
    //         fs.unlinkSync(downPath);
    //         this.updateAttr("upVersion", {date: new Date()});
    //         return this.startup();
    //     })
    // }
}

module.exports = ESwarm;