const iotBase = require('./iotBase');
const P = require('bluebird');
const { exec,execSync } = require('child_process');
const si = require('systeminformation');
const {machineId, machineIdSync} = require('node-machine-id');
const _ = require('lodash');
const axios = require('axios');
const formData = require('form-data');
const fs = require('fs');
const path = require('path');
const packageConfig = require("../package.json");
const Config = require(`${process.cwd()}/config.json`);
/**
 * System info class
 *
 * attributes:
 *    cpuNum:  total cpu number
 *
 *    cpuLoad: current cpu load info  from 0-1 means 0% ... 100%
 *
 *    memFree: free memory
 *    memTotal: total memory
 *
 *    create:  create a miner
 *    {
 *    .type   miner name
 *
 *    .config create param
 *    }
 */

class SysInfo extends iotBase{

    constructor(gw) {
        super('sysInfo',gw,false);
    }



    startup(){
        //添加本地时间上报
        this.updateAttr('time',new Date());
        //将cdsc_daemon版本信息加上
        this.updateAttr('cdscVersion',packageConfig.version);
        this.updateAttr('sUUID',(machineIdSync(true) || "").replace(/-/g,''));
        P.resolve().then(si.osInfo).then(result=>{
            this.updateAttr('platform',result.platform);
            this.updateAttr("arch",result.arch);
            this.updateAttr("hostname",result.hostname);
        });
        this.check();
        setInterval(this.check.bind(this),60000);
        setInterval(()=>{
            this.updateAttr('time',new Date());
        },_.toNumber(Config.getTimeInterval || '3600000'));
    }

    check(){

        P.resolve().then(si.mem).then(result=>{
            this.updateAttr('totalMem',_.toNumber((result.total/(1000*1000*1000)).toFixed(1)));
            this.updateAttr("freeMen",_.toNumber((result.free/(1000*1000*1000)).toFixed(1)));
            this.updateAttr("activeMem",_.toNumber((result.active/(1000*1000*1000)).toFixed(1)));
        });

        P.resolve().then(si.currentLoad).then((result)=>{
            this.updateAttr("cpuLoad",_.toNumber(result.currentload.toFixed(1)));
            this.updateAttr("loadAvg",_.toNumber(result.avgload));
        });

        // P.resolve().then(si.networkStats).then((result)=>{
        //     if (_.isArray(result) && result.length >0){
        //         let network = result[0];
        //         this.updateAttr("netRx",(network.rx_sec/1024).toFixed(1));
        //         this.updateAttr("netTx",(network.tx_sec/1024).toFixed(1));
        //     }
        // });

        P.resolve().then(si.fsSize).then((result)=>{
            let diskSize = 0
            let usedSize = 0
            // if (Config.disklayout  === "v2"){
            //     _.each(result,(item)=>{
            //         if (item.fs == '/dev/mapper/vgeswarm-eswarm'){
            //             diskSize = item.size;
            //             usedSize = item.used;
            //         }
            //     })
            //
            // }else{
            //     let disks = this.gateway.iots.diskInfo.attributes.disks
            //     _.each(result,(item)=>{
            //         if (item.type == 'ext4' && item.mount && item.mount != '/') {
            //             _.each(disks,(disk) => {
            //                 if (disk.name == item.fs) {
            //                     diskSize += item.size
            //                     usedSize += item.used
            //                 }
            //             })
            //
            //         }
            //     })
            // }
            _.each(result,(item)=>{
                if (item.type == 'ext4'){
                    diskSize += item.size;
                    usedSize += item.used;
                }
            })

            this.updateAttr("diskSize",_.toNumber((diskSize/(1000*1000*1000)).toFixed(1)));
            this.updateAttr("diskUse",_.toNumber((usedSize/(1000*1000*1000)).toFixed(1)));
        });
        P.resolve().then(si.cpu).then((result)=>{
            this.updateAttr("cpuBrand",result.brand);

        });
        P.resolve().then(si.osInfo).then(result=>{
            this.updateAttr("hostname",result.hostname);
        });
        //上传/mnt/data的磁盘大小
        P.resolve().then(()=>{
            if (this.checkPath('/mnt/data')) {
                //this.updateAttr("mntDataMount",0);
                if (execSync(`mount -l |grep "on /mnt/data type ext4 ("|awk -F "(" '{print $2}' |awk -F "," '{print $1}'`).toString().trim() == 'ro'){
                    this.updateAttr("data",0);
                } else{
                    let mntDataSize = execSync("df /mnt/data|awk '{if(NR==2){print $2}}'").toString().trim();
                    let result = _.toNumber(mntDataSize);
                    if (!_.isNaN(result)){
                        this.updateAttr("data",Math.round(result/1024/1024*100)/100);
                    }else{
                        this.updateAttr("data",0);
                    }
                }
            }else{
                //this.updateAttr("mntDataMount",1);
                this.updateAttr("data",-1);
            }
            this.updateAttr("dataUse",this.getCache('/mnt/data'));
        })
    }

    //重启
    reboot() {
        setTimeout(() => {
            exec("reboot",(error,stdout,stdin)=>{});
        },2000);
        return P.resolve();
    }
    checkPath(path){
        let checkResult = null;
        try{
            checkResult = execSync(`df | grep ${path}`).toString();
        }catch (e) {
            console.log(e.message);
            return false;
        }
        if (!checkResult) {
            return false;
        }
        return true;
    }

}

module.exports = SysInfo;