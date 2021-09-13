const iotBase = require('./iotBase');
const fs = require('fs');
const {spawn,spawnSync,execSync} = require('child_process');
const _ = require('lodash');
const P = require('bluebird');
const os = require('os');
const Config = require(`${process.cwd()}/config.json`);

class Ptfs extends iotBase{
    constructor(gw){
        super('ptfs',gw,{isApp:true,num:'04'});
        this.curDir = process.cwd();
        //不设置初始化运行状态
        this.updateAttr('state','stop');
        this.updateAttr('status',0);
        //this.toState = "Stop"
        this.getVersion();
        setInterval(() => {
            this.checkService();
            this.getStatus();
            // if (this.toState == "online") {
            //     if(!this.process && !this.onStarting) {
            //         this.startup();
            //     }
            // } else {
            //     if (this.process) {
            //         this.stop()
            //     }
            // }
        }, 60000)
    }

    startup(){
        this.stop();
        setInterval(()=>{
            this.getVersion();
            this.updateAttr("cache",this.getCache('/mnt/data/.ptfsMiner'));
            //this.getCache();
        },_.toNumber(Config.netInfoIntervalTime || '300000'));
    }
    checkService(){
        if (!this.gateway.serviceJson) {
            this.stop();
            return;
        }
        let ptfsConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};
        //ptfsConfig = {active:true};
        this.updateAttr('require',ptfsConfig.active);
        if (ptfsConfig.active && this.attributes.state == "stop" && !this.onStarting) {
            this.start();
            return;
        }
        if (!ptfsConfig.active && this.attributes.state != "stop") {
            this.stop();
            return;
        }
    }

    start(){
        if(!this.onStarting){
            this.onStarting = true
            this.stop().then(() => {
                //this.toState = "online";
                return new P((reslove)=>{
                    setTimeout(()=>{
                        reslove()
                    },15000)
                }).then(()=>{
                    return this.startPt();
                })
            }).finally(()=>{
                this.onStarting = false
            })
        }
    }
    stop(){
        if (this.process) {
            this.process.kill("SIGKILL");
            this.doExecSync(`kill -9 ${this.process.pid}`);
            this.process = null;
            //this.toState = "offline"
        }
        return new P((reslove)=>{
            setTimeout(()=>{
                reslove()
            },1000)
        })
    }
    //
    getStatus(){
        let ptfsConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};

        if (ptfsConfig && ptfsConfig.active) {
            if (this.attributes.state == 'start' ) {
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
    startPt() {
        let ptfsPath = this.getPtfsPath();
        if (!fs.existsSync(ptfsPath)) {
            this.updateAttr("state", "stop");
            return P.reject("no ptIpfs");
        }
        this.updateAttr('startTime', new Date());
        //判断/mnt/data是否存在
        if (!this.checkPath('/mnt/data')){
            return;
        }
        // let args = [];
        // _.each(this.args, (v, k) => {
        //     args.push(k);
        //     args.push(v);
        // });
        //判断/mnt/data是否存在
        // let checkResult = null;
        // try{
        //     checkResult = execSync(`cd /mnt/eswarm`).toString();
        // }catch (e) {
        //     console.log(e.message);
        //     return;
        // }
        // if (checkResult) {
        //     return;
        // }

        this.process = spawn(ptfsPath, ['daemon','--init']);
        //this.process = spawn(yfPath);
        console.log('ptfs pid:',this.process.pid);
        this.addProcess(this.iotId,[this.process.pid]);
        this.updateAttr("state", "start");

        this.process.stdout.on('data', (data) => {
            //console.log(data.toString());
        });
        this.process.stderr.on('data', (data) => {
            console.log(data.toString());
        });
        this.process.on('close', (code) => {
            this.process = undefined
            this.updateAttr('state', 'stop');
            console.log('ptfs stop !!!');
        });
    }
    getPids(){
        let pids = [];
        if (this.process){
            pids.push(this.process.pid);
        }
        console.log('get ptfs pids:',pids);
        return pids;
    }
    getPtfsPath() {
        let ptfsPath = `${this.curDir}/cdsc/linux/ipfs`;
        if (os.type() == "Windows_NT") {
            ptfsPath = `${this.curDir}/cdsc/win32/ipfs.exe`;
        }else if(os.type() == "Darwin"){
            ptfsPath = `${this.curDir}/cdsc/macos/ipfs`;
        }
        return ptfsPath;
    }
    killChildProcess(process){
        try{
            execSync('kill -9 ' + process.pid);
        }catch (e) {
            console.log(e.message)
        }
    }
    // getCache(){
    //     P.resolve().then(()=>{
    //         let cacheUseStr = execSync("du -s /mnt/data/.ptfsMiner |awk '{print $1}'").toString();
    //         if (cacheUseStr != ""){
    //             let cacheUse = Math.round(_.toNumber(cacheUseStr)/1024/1024 * 100) / 100;
    //             if (!_.isNaN(cacheUse)){
    //                 this.updateAttr("cache",cacheUse);
    //             }
    //         }
    //     })
    // }
    getVersion() {
        let arg = ["--version"];
        let process = spawnSync(this.getPtfsPath(), arg);
        let verString = (process.stdout && process.stdout.toString()) || "";
        //let versions = verString.match(/eswarm version ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})-([a-zA-Z]*)(-([0-9a-fA-F]*))?/) || [];
        let versions = verString.match(/ipfs version ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/) || [];
        let hashStr = this.getMd5(`${this.curDir}/cdsc/linux/ipfs`);
        this.updateAttr("version", {value:versions[1] || "",md5:hashStr})
    }
    getPtfsPath() {
        let ptfsPath = `${this.curDir}/cdsc/linux/ipfs`;
        if (os.type() == "Windows_NT") {
            ptfsPath = `${this.curDir}/cdsc/win32/ipfs.exe`;
        }else if(os.type() == "Darwin"){
            ptfsPath = `${this.curDir}/cdsc/macos/ipfs`;
        }
        return ptfsPath;
    }
}

module.exports = Ptfs;