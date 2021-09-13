const iotBase = require('./iotBase');
const fs = require('fs');
const {spawn,spawnSync,execSync} = require('child_process');
const _ = require('lodash');
const P = require('bluebird');
const os = require('os');
const Config = require(`${process.cwd()}/config.json`);

class Yfminer extends iotBase{
    constructor(gw){
        super('yf',gw,{isApp:true,num:'03',name:'yf'});
        this.curDir = process.cwd();
        //不设置初始化运行状态
        this.updateAttr('state','stop');
        this.updateAttr('status',0);
        //this.toState = "Stop"
        // 取文件hash8位作为version
        this.updateAttr('version',this.getMd5(`${this.curDir}/cdsc/linux/yfnode`));

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
            let yfPid = null;
            try{
                yfPid = execSync(`/usr/bin/pgrep yfnode`).toString().trim();
                if (yfPid != this.oldPid){
                    this.addProcess(this.iotId,[yfPid]);
                    this.oldPid = yfPid;
                }
            }catch (e) {
                console.log(e.message)
            }
        }, 60000)
    }

    startup(){
        this.stop();
        setInterval(()=>{
            this.updateAttr('version',this.getMd5(`${this.curDir}/cdsc/linux/yfnode`));
            this.updateAttr("cache",this.getCache('/mnt/data/.yfnode'));
            //this.getCache();
        },_.toNumber(Config.netInfoIntervalTime || '300000'));
    }
    checkService(){
        if (!this.gateway.serviceJson) {
            this.stop();
            return;
        }
        let yfConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};
        //yfConfig = {active:true};
        this.updateAttr('require',yfConfig.active);
        if (yfConfig.active && this.attributes.state == "stop" && !this.onStarting) {
            this.start();
            return;
        }
        if (!yfConfig.active && this.attributes.state != "stop") {
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
                    return this.startYf();
                })
            }).finally(()=>{
                this.onStarting = false
            })
        }
    }
    stop(){
        if (this.process) {
            this.process.kill("SIGKILL");
            this.doExecSync(`kill -9 ${this.process.pid}`)
            this.process = null;
            //this.toState = "offline"
        }
        //杀死yfnode
        this.doExecSync(`pkill yfnode`);
        return new P((reslove)=>{
            setTimeout(()=>{
                reslove()
            },1000)
        })
    }
    //
    getStatus(){
        let yfConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};

        if (yfConfig && yfConfig.active) {
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
    startYf() {
        let yfPath = this.getYfPath();
        if (!fs.existsSync(yfPath)) {
            this.updateAttr("state", "stop");
            return P.reject("no yfminer");
        }
        this.updateAttr('startTime', new Date());
        // let args = [];
        // _.each(this.args, (v, k) => {
        //     args.push(k);
        //     args.push(v);
        // });
        //判断/mnt/data是否存在
        if (!this.checkPath('/mnt/data')){
            return;
        }
        // let checkResult = null;
        // try{
        //     checkResult = execSync(`cd /mnt/data`).toString();
        // }catch (e) {
        //     console.log(e.message);
        //     return;
        // }
        // if (checkResult) {
        //     return;
        // }

        this.process = spawn(yfPath, ['/mnt/data']);
        //this.process = spawn(yfPath);
        console.log('yf pid:',this.process.pid);

        //查找真正的yfnode pid
        let yfPid = execSync(`/usr/bin/pgrep yfnode`).toString().trim();
        //let yfPids = yfPid.split('\n');
        this.oldPid = yfPid;
        this.addProcess(this.iotId,[yfPid]);

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
            console.log('yfminer stop !!!');
        });
    }
    getPids(){
        let pids = [];
        if (this.process){
            pids.push(this.process.pid);
        }
        console.log('get yf pids:',pids);
        return pids;
    }
    getYfPath() {
        let yfPath = `${this.curDir}/cdsc/linux/yfnode`;
        if (os.type() == "Windows_NT") {
            yfPath = `${this.curDir}/cdsc/win32/yfnode.exe`;
        }else if(os.type() == "Darwin"){
            yfPath = `${this.curDir}/cdsc/macos/yfnode`;
        }
        return yfPath;
    }
    killChildProcess(){
        try{
            execSync('kill -9 ' + this.process.pid);
        }catch (e) {
            console.log(e.message)
        }
    }
    // getCache(){
    //     P.resolve().then(()=>{
    //         let cacheUseStr = execSync("du -s /mnt/data/.yfnode |awk '{print $1}'").toString();
    //         if (cacheUseStr != ""){
    //             let cacheUse = Math.round(_.toNumber(cacheUseStr)/1024/1024 * 100) / 100;
    //             if (!_.isNaN(cacheUse)){
    //                 this.updateAttr("cache",cacheUse);
    //             }
    //         }
    //     })
    // }

}

module.exports = Yfminer;