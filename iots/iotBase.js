const EventEmitter = require('events');
const _ = require('lodash');
const P = require('bluebird');
const udev = require("udev");
const process = require('process');
const {spawn,spawnSync,execSync} = require('child_process');
const Config = require(`${process.cwd()}/config.json`);
const fs = require('fs')

class IotBase extends EventEmitter{

    constructor(iotId,gw,{isApp,num,name}) {
        super();
        this.iotId = iotId || '';
        this.appName = name || iotId;
        this.isApp = isApp;
        this.cgroup = num;
        this.attributes = {};
        this.gateway = gw
        this.diskMonitor = udev.monitor("block");
    }

    /**
     * 更新某个属性，会通过gate
     * @param attr 某个属性值
     * @param value  需要提供的值，包括options
     * @returns {{}}
     */
    updateAttr(attr,value,forced){
        if(forced || !_.isEqual(this.attributes[attr],value)){
            this.attributes[attr] = _.cloneDeep(value);
            this.emit('update',this.iotId,attr,value);
        }
    }

    /**
     * 响应读取请求
     * @param attr 要读取的属性
     * @param params  读取的参数
     * @returns {{}}  返回值，将会被发送到读取的发起者
     */
    onRead(attr,params){
        if(attr === "__all__"){
            return P.resolve(this.attributes)
        }else if (_.has(this.attributes,attr)){
            return P.resolve(this.attributes[attr]);
        }
        return P.reject(`attribute ${attr} is not supported`);
    }

    /**
     * 响应写入请求
     * @param attr 要写入的属性
     * @param params 写入的内容或是参数
     * @returns {{}} 返回值，将会被发送到写入的发起者
     */
    onWrite(attr,params){

        if(_.isFunction(this[attr])){
            return P.resolve().then(()=>{
                return this[attr](params);
            })
        }
        else {
            return P.reject(`no ${attr} attribute`);
        }

    }
    addProcess(iotId,pids){
        this.emit('addProcess',iotId,pids);
    }
    doExecSync(param){
        try {
            return execSync(param)
        }catch (e) {
            console.log(e.Error || e.message || e)
        }
    }

    killChildProcess(){
        return;
    }
    checkPath(path){
        let checkResult = null;
        let disksize = this.gateway.iots.sysInfo.attributes.diskSize;
        try{
            //checkResult = execSync(`cd ${path}`).toString();
            checkResult = execSync(`df | grep ${path}`).toString();
        }catch (e) {
            console.log(e.message);
            if (disksize && disksize >= _.toNumber(Config.singleDiskSize || 80)) {
                return true;
            }
            return false;
        }
        if (!checkResult && disksize && disksize < _.toNumber(Config.singleDiskSize || 80)) {
            return false;
        }
        return true;

    }
    getCache(path){
        let cacheUse = 0;
        let cacheUseStr = execSync(`du -s ${path} |awk '{print $1}'`).toString();
        if (cacheUseStr != ""){
            let cacheUseNum = Math.round(_.toNumber(cacheUseStr)/1024/1024 * 100) / 100;
            if (!_.isNaN(cacheUseNum)){
                cacheUse = cacheUseNum;
            }
        }
        return cacheUse;

    }
    getMd5(path) {
        let result = "";
        if (fs.existsSync(path)){
            try{
                let resultStr = execSync(`md5sum ${path}`).toString();
                if (resultStr){
                    result = resultStr.split(" ")[0].substring(0,8);
                }
            }catch (e) {
                console.log(e.message);
            }
        }
        return result;
    }
    // checkDataSize(){
    //
    //     this.gateway.iots.sysInfo.attributes.data
    // }
}

module.exports = IotBase;