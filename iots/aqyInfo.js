const iotBase = require('./iotBase');
const {execSync,exec,spawnSync} = require('child_process');
const crypto = require('crypto');
const Config = require(`${process.cwd()}/config.json`);
const _ = require('lodash');
const P = require('bluebird');

/**
 * 1.不设置初始化运行状态，刚启动时不操作ipes和td_client服务
 * 2.根据下发的service来确认启动服务还是关闭服务
 * 3.state=true:ipes和td_client同时在运行；否则state=stop;
 * 4.status=0(正常);1(ipes不正常);2(td_client不正常);3(ipes,td_client都不正常)
 * 5.心跳保护程序：检查status,根据status判断是否启动或关闭,检查status
 */
class AqyInfo extends iotBase{
    constructor(gw){
        super('aqyInfo',gw,{isApp:true,num:'02',name:"aqy"});
        //不设置初始化运行状态
        //this.updateAttr('state','stop');
        this.updateAttr('status',0);
        this.getVersion();
    }

    startup(){
        this.getStatus();
        //let aqyConfig = this.gateway.serviceJson && this.gateway.serviceJson.aqy;
        setInterval(()=>{
            if (!this.checkPath('/mnt/data')){
                return;
            }
            this.getStatus();
            this.checkService();
            // if (this.attributes.status == 1 && aqyConfig && aqyConfig.active){
            //     this.start();
            // }
            // if (this.attributes.status == 1 && aqyConfig && !aqyConfig.active){
            //     this.stop();
            // }
            this.getStatus();
            //获取pids
            let pids = this.getpds();
            if (pids && pids.length > 0){
                let sumString = "";
                _.each(pids,(item,index)=>{
                    sumString += item.toString();
                })
                let hash = crypto.createHash('md5').update(sumString).digest("hex");
                if (hash != this.oldhash){
                    this.addProcess(this.iotId,pids);
                }
                this.oldhash = hash;
            }
        }, 60000);
        setInterval(()=>{
            this.updateAttr("cache",this.getCache('/mnt/data/aiqiyi') || this.getCache('/mnt/data/hdata'));
            this.getVersion();
            //this.getCache();
        },_.toNumber(Config.netInfoIntervalTime || '300000'));
    }
    getPids(){
        let pids = this.getpds();
        if (pids && pids.length > 0){
            let sumString = "";
            _.each(pids,(item,index)=>{
                sumString += item.toString();
            })
            let hash = crypto.createHash('md5').update(sumString).digest("hex");
            this.oldhash = hash;
        }
        return pids;
    }
    getpds(){
        let pids = [];
        try{
            let res = execSync( `systemctl status ipes |awk '{print $1}'`).toString().trim().split('\n');
            _.each(res,(item,index)=>{
                //if (/^├─|└─/.test(item)){
                if (/─\d|-\d/.test(item)){
                    let arr = /\d*$/.exec(item);
                    if(arr && arr.length > 0 && arr[0]!=''){
                        pids.push(_.toNumber(arr[0]));
                    }
                }
            })
            pids = _.sortBy(pids);
            // let pid = execSync( `systemctl status ipes |awk '{if(NR==5)print $3}'`).toString().trim();
            // if (!_.isNaN(_.toNumber(pid))){
            //     pids.push(pid);
            //     this.pid = pid;
            // }
        }catch (e) {
            console.log(e.message);
        }
        return pids;
    }
    checkService(){
        //没有下发service,改成不影响服务的启停
        if (!this.gateway.serviceJson) {
            return;
        }
        let aqyConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};
        this.updateAttr('require',aqyConfig.active);
        // if (aqyConfig.active && this.attributes.state == "stop") {
        //     //this.updateAttr('state','stop');
        //     this.start();
        //     return;
        // }
        // if (!aqyConfig.active && this.attributes.state == "start") {
        //     //this.updateAttr('state','start');
        //     this.stop();
        //     return;
        // }
        if (aqyConfig.active && this.attributes.status != 0) {
            //this.updateAttr('state','stop');
            this.start();
            return;
        }
        if (!aqyConfig.active && this.attributes.status != 0) {
            //this.updateAttr('state','start');
            this.stop();
            return;
        }
    }
    //ipes,td_client同时起state=start;否则state=stop
    start(){
        if (!this.checkPath('/mnt/data')){
            return;
        }
        let result = true;
        try{
            execSync("systemctl start ipes");
            //this.updateAttr('state','start');
        }catch(e){
            console.log(e.message);
            this.updateAttr('state','stop');
            result = false;
        }
        try{
            execSync("systemctl start td_client");
            //this.updateAttr('state','start');
        }catch(e){
            console.log(e.message);
            this.updateAttr('state','stop');
            result = false;
        }
        if (result) {
            this.updateAttr('state','start');
        }
        try{
            execSync("systemctl start aqy.timer");
        }catch(e){
            console.log(e.message);
        }
        // //启动结算服务
        // try{
        //     execSync("systemctl start td_client");
        //     this.updateAttr('tcState','start');
        // }catch(e){
        //     console.log(e.message);
        //     this.updateAttr('tcState','stop');
        // }
    }
    //ipes,td_client关闭一个服务state=stop,
    stop(){
        try{
            execSync("systemctl stop ipes");
            this.updateAttr('state','stop');
        }catch(e){
            console.log(e.message);
        }
        try{
            execSync("systemctl stop aqy.timer");
        }catch(e){
            console.log(e.message);
        }
        //关闭结算服务
        try{
            execSync("systemctl stop td_client");
            this.updateAttr('state','stop');
        }catch(e){
            console.log(e.message);
        }
    }
    //0正常；1ipes异常；2td_client异常；3都异常
    getStatus(){
        let aqyConfig = this.gateway.serviceJson && this.gateway.serviceJson[this.appName] || {};
        let statusNum = 0;

        let resultBuffer = null;
        let checkResult = null;
        try{
            resultBuffer = execSync("systemctl status ipes");
        }catch (e) {
            console.log(e.message);
            //没有serviceJson.aqy,status=0
            if (!aqyConfig) {
                //this.updateAttr('status',0);
                statusNum += 0;
            }else if (aqyConfig.active) {
                //this.updateAttr('status',1);
                statusNum += 1;
            }else{
                //this.updateAttr('status',0);
                statusNum += 0;
            }
            this.updateAttr('state','stop');
            //return;
        }
        if (resultBuffer) {
            checkResult = resultBuffer.toString().split('\n')[2].split(/\s+/)[2];
            if (checkResult && checkResult == 'active' && (!aqyConfig || aqyConfig.active)) {
                //this.updateAttr('status',0);
                statusNum += 0;
            }else{
                //this.updateAttr('status',1);
                statusNum += 1;
            }
        }

        let resultBuffer2 = null;
        let checkResult2 = null;
        try{
            resultBuffer2 = execSync("systemctl status td_client");
        }catch (e) {
            console.log(e.message);
            //没有serviceJson.aqy,status=0
            if (!aqyConfig) {
                //this.updateAttr('status',0);
                statusNum += 0;
            }else if (aqyConfig.active) {
                //this.updateAttr('status',1);
                statusNum += 2;
            }else{
                //this.updateAttr('status',0);
                statusNum += 0;
            }
            this.updateAttr('state','stop');
            //return;
        }
        if (resultBuffer2) {
            checkResult2 = resultBuffer2.toString().split('\n')[2].split(/\s+/)[2];
            if (checkResult2 && checkResult2 == 'active' && (!aqyConfig || aqyConfig.active)) {
                //this.updateAttr('status',0);
                statusNum += 0;
            }else{
                //this.updateAttr('status',1);
                statusNum += 2;
            }
        }
        this.updateAttr('status',statusNum);
        //全部正常，设置state
        if (checkResult && checkResult == 'active' && checkResult2 && checkResult2 == 'active') {
            this.updateAttr('state','start');
        }else{
            this.updateAttr('state','stop');
        }
    }
    // getCache(){
    //     P.resolve().then(()=>{
    //         let cacheUseStr = execSync("du -s /mnt/data/aiqiyi |awk '{print $1}'").toString();
    //         if (cacheUseStr != ""){
    //             let cacheUse = Math.round(_.toNumber(cacheUseStr)/1024/1024 * 100) / 100;
    //             if (!_.isNaN(cacheUse)){
    //                 this.updateAttr("cache",cacheUse);
    //             }
    //         }
    //     })
    // }
    getVersion() {
        let ipesPath = ["/mnt/data/aiqiyi/ipes/bin/ipes","/opt/ipes/bin/ipes"];
        let tdPath = "/opt/td_client/td_client";
        this.updateAttr("version", {
            ipes: this.getIpesVersion(ipesPath) || "",
            td: this.getMd5(tdPath) || ""
        })
    }
    getIpesVersion(ipesPath){
        let result = "";
        let arg = ["version"];
        let verString = "" ;
        _.each(ipesPath,(item)=>{
            let process = spawnSync(item, arg);
            verString = (process.output && process.output.toString()) || "";
            if (verString) {
                return false;
            }
        })
        if (verString) {
            let verstr = verString.split("\n")[1];
            let versions = verstr.match(/IPES version ([0-9a-f]{1,6})/) || [];
            result = versions[1];
        }
        return result;
    }



}

module.exports = AqyInfo;