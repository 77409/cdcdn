const iotBase = require('./iotBase');
const fs = require('fs');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const _ = require('lodash');
const P = require('bluebird');
const {execSync,exec} = require('child_process');
const si = require('systeminformation');
const moment = require('moment');
const Config = require(`${process.cwd()}/config.json`);
const publicIp = require("public-ip");
//const natUpnp = require('nat-upnp');
const natUpnp = require('nat-upnp-2');

class NetInfo extends iotBase{
    constructor(gw){
        super('netInfo',gw,false);
        this.last = {};
    }

    startup(){
        this.getInnerIp();
        this.getOuterIp();
        this.getPublicIpAndNatType();
        this.checkDelayResult();
        //this.getFlow();
        // setInterval(()=>{
        //     this.getFlow();
        // }, _.toNumber(Config.netInfoIntervalTime || '300000'));
        setInterval(()=>{
            this.getInnerIp();
            this.getOuterIp();
            this.getPublicIpAndNatType();
            this.checkDelayResult();
        }, _.toNumber(Config.netInfoTime || '3600000'));
    }

    /**
     * 获取默认网卡名称
     * @returns {*}
     */
    // getDefaultInterface(){
    //     P.resolve().then(si.networkInterfaceDefault).then((result)=>{
    //         this.updateAttr("defaultInterface",result);
    //     })
    // }

    /**
     * 获取内网地址
     */
    getInnerIp(){
        P.resolve().then(si.networkInterfaceDefault).then((defaultInterface)=>{
            return si.networkInterfaces().then((result)=>{
                if (_.isArray(result) && result.length >0){
                    _.each(result,(item)=>{
                        if (item.iface == defaultInterface) {
                            this.updateAttr("innerIp",item.ip4);
                            this.updateAttr("mac",item.mac.replace(/:/g,"").toUpperCase());
                        }
                    })
                }
            })
        })
    }


     /**
     * 获取网络延时时间
     */
    checkDelayResult(){
        let result = null;
        let niLogBuffer = null;
        try{
            niLogBuffer = execSync("traceroute -m 5 114.114.114.114");
        }catch(e){
            console.log(e.message);
            return;
        }
        let niLog = niLogBuffer.toString();
        if (niLog) {
            let checkLog = niLog.split('\n')[1];
            let detalArray = checkLog.split(/\s+/);
            let msIndex = _.findIndex(detalArray,(item)=>{
                return item == 'ms';
            });
            if (msIndex > 1){
                result = detalArray[msIndex - 1];
            }
        }
        //this.delayStatus = (result && result > 100) ? false : true;
        if (result) {
            this.updateAttr('delayTime',result);
        }

    }

    // getPublicIp(){
    //     return publicIp.v4({timeout: 5000}).then((ip)=>{
    //         this.updateAttr('publicIp',ip);
    //         return P.resolve();
    //     }).catch((e)=>{
    //         console.log(e.message);
    //         return P.resolve();
    //     })
    // }
    getPublicIpAndNatType(){
        let natPath = `${process.cwd()}/ntc/linux/ntc_client`;
        let args = [];
        //console.log('ntc_client begin');
        if (!fs.existsSync(natPath)){
            return;
        }
        this.process = spawn(natPath, args);
        this.process.stdout.on('data', (data) => {
            //解析data
            //console.log('ntc_client data show');
            let dataResult = null;
            try{
                dataResult = JSON.parse(data.toString());
            }catch (e) {
                console.log('ntc_client return:',data.toString());
                console.log(e);
            }
            if (dataResult) {
                this.updateAttr('publicIp',dataResult.external_ip);
                this.updateAttr('nat_type',dataResult.nat_type);
            }
        });

        this.process.stderr.on('data', (data) => {
            //console.log('ntc_client data error');
            console.log(data.toString());
            //console.log('natClientError:',dataResult);
        });
        this.process.on('close', (code) => {
            this.process = undefined;
            //console.log('ntc_client close');
        });
    }


    //1.获取exterIp,没有：outerIp = innerIp;upnp=false;
    //2.有exterIp,outerIp =该Ip;进行端口映射，成功upnp=true,失败upnp=false
    getOuterIp(){
        let upnpClient = natUpnp.createClient();
        let externalIp = P.promisify(upnpClient.externalIp,{context: upnpClient});
        let getMappings = P.promisify(upnpClient.getMappings,{context: upnpClient});
        // let externalIp = P.promisify(this.upnpClient.externalIp,{context: this.upnpClient});
        // let getMappings = P.promisify(this.upnpClient.getMappings,{context: this.upnpClient});
        externalIp().then(extIp=>{
            //console.log('进入externalIp()then');
            //console.log('extip:',extIp);
            return P.resolve();
        }).catch(err=>{
            //console.log('进入externalIp()catch');
            //console.log('getExtIpError',err);
            return P.resolve();
        }).then(()=> {
            return getMappings({ local: true })
        }).then(()=>{
            //console.log('进入getMappings()then');
            this.updateAttr("upnp", true);
            //console.log('upnp:',true);
            return P.resolve();
        }).catch((e)=>{
            //console.log('进入getMappings()catch');
            this.updateAttr("upnp", false);
            //console.log('upnp:',false);
            return P.resolve();
        }).then(()=>{
            return externalIp();
        }).then(extIp=>{
            //console.log('进入externalIp()then');
            this.updateAttr("outerIp",extIp);
            //console.log('extip:',extIp);
            return P.resolve();
        }).catch(err=>{
            //console.log('进入externalIp()catch');
            //console.log('getExtIpError',err);
            this.updateAttr("outerIp","");
            return P.resolve();
        }).finally(()=>{
            upnpClient.close();
        })
    }

    /**
     * 获取外部IP，外部端口，对外端口开放状态
     */
    // getOuterPortStatus(){
    //     let outerPortStatus = false;
    //     let nodePath =  path.join('/dev/shm/nodeinfo');
    //     if (fs.existsSync(nodePath)) {
    //         let enode = fs.readFileSync(nodePath).toString();
    //         if (enode) {
    //             let enodeFront = enode.split('?')[0];
    //             if (enodeFront) {
    //                 let outerPort = enodeFront.split(':')[2];
    //                 if (outerPort) {
    //                     this.updateAttr('outerPort',outerPort);
    //                     let outerIp = enodeFront.split(':')[1].split('@')[1];
    //                     this.updateAttr('outerIp',outerIp);
    //                     let portStatus = execSync(`nmap -Pn ${outerIp} -p ${outerPort} |awk '{if(NR==6){print $0}}' |awk '{print $2}'`).toString();
    //                     console.log('portStatus:',portStatus);
    //                     outerPortStatus = /^open/.test(portStatus)?true : false;
    //                     console.log('outerPortStatus:',outerPortStatus);
    //                 }

        // P.resolve().then(this.upnpClient.externalIp((err, extIp)=>{
        //     if (err) {
        //
        //         this.updateAttr("upnp",false);
        //         return;
        //     }
        //
        //
        //     //let privatePort = Math.floor(Math.random() * 65536);
        //
        //     return P.resolve().then(
        // })).catch((e)=>{
        //     console.log(e);
        // })

    //             }
    //         }
    //     }
    //     return outerPortStatus;
    // }

    /**
     * 获取矿机异常数据的最终结果
     */
    // getStatus(){
    //     let delayResult = this.delayStatus;
    //     // console.log('delayResult',delayResult);
    //     let portResult = this.getOuterPortStatus();
    //     // console.log('portResult',portResult);
    //     //this.updateAttr("status",(delayResult?0:2) + (portResult?0:1));
    //     this.updateAttr("status",(portResult?0:1) + (delayResult?0:2) + (this.gateway.iots.eSwarm.isDiskOn?0:4));
    // }

    /**
     * 获取网络下行和上行数据
     */
    // getFlow(){
    //     let intervalTime = Config.netInfoIntervalTime || '300000';
    //     P.resolve().then(si.networkInterfaceDefault).then((defaultInterface)=>{
    //         return si.networkStats().then((result)=>{
    //             let obj = {}
    //             if (_.isArray(result) && result.length >0){
    //                 _.each(result,(item)=>{
    //                     if (item.iface == defaultInterface) {
    //                         _.extend(obj,{rxBytes:item.rx_bytes});
    //                         _.extend(obj,{rxErrors:item.rx_errors});
    //                         _.extend(obj,{rxDropped:item.rx_dropped});
    //                         _.extend(obj,{txBytes:item.tx_bytes});
    //                         _.extend(obj,{txErrors:item.tx_errors});
    //                         _.extend(obj,{txDropped:item.tx_dropped});
    //                     }
    //                 })
    //
    //             }
    //             if (_.isEmpty(obj)){
    //                 return P.reject('find no network interface');
    //             }
    //             return P.resolve(obj);
    //         })
    //     }).then(({rxBytes,rxErrors,rxDropped,txBytes,txErrors,txDropped})=>{
    //         if (!this.last || _.isEmpty(this.last)){
    //             //第一次只记录网卡记录
    //             this.last = {rxBytes,rxErrors,rxDropped,txBytes,txErrors,txDropped};
    //             return P.resolve({});
    //         } else{
    //             //计算间隔时间平均流量值
    //             let addRxBytes = rxBytes - this.last.rxBytes;
    //             let addRxErrors = rxErrors - this.last.rxErrors;
    //             let addRxDropped = rxDropped - this.last.rxDropped;
    //             let addTxBytes = txBytes - this.last.txBytes;
    //             let addTxErrors = txErrors - this.last.txErrors;
    //             let addTxDropped = txDropped - this.last.txDropped;
    //
    //             let rxSec = _.toNumber((addRxBytes/(_.toNumber(intervalTime)/1000)).toFixed(0));
    //             this.updateAttr("rxSec",rxSec);
    //             let txSec = _.toNumber((addTxBytes/(_.toNumber(intervalTime)/1000)).toFixed(0));
    //             this.updateAttr("txSec",txSec);
    //             this.last = {rxBytes,rxErrors,rxDropped,txBytes,txErrors,txDropped};
    //             return P.resolve({addRxBytes,addRxErrors,addRxDropped,addTxBytes,addTxErrors,addTxDropped})
    //                 .then((addResult)=>{
    //                     //计算流量统计值,错误包数，丢包数，（先按小时统计）
    //                     let aggTime = moment().startOf('hour').format('YYYY-MM-DD HH');
    //                     //获取flow.json的数据
    //                     let flowPath = path.join(process.cwd(), "flow.json");
    //                     let flowData = {};
    //                     if (fs.existsSync(flowPath)){
    //                         let data
    //                         try{
    //                             data = fs.readFileSync(flowPath);
    //                         }catch(e){
    //                             console.log('flow.json文件读取不了：',e);
    //                             fs.unlinkSync(flowPath);
    //                             return P.reject(e.message);
    //                         }
    //                         try {
    //                             flowData = JSON.parse(data.toString());
    //                         } catch (e) {
    //                             console.log('JSON文件转换不了：',e);
    //                             fs.unlinkSync(flowPath);
    //                             return P.reject(e.message);
    //                         }
    //                     }
    //                     //保存数据
    //                     let newAggResult = {};
    //                     let aggResult = flowData[aggTime];
    //
    //                     newAggResult.rxBytesAgg = (aggResult?aggResult.rxBytesAgg:0) + addResult.addRxBytes;
    //                     newAggResult.rxErrorsAgg = (aggResult?aggResult.rxErrorsAgg:0) + addResult.addRxErrors;
    //                     newAggResult.rxDroppedAgg = (aggResult?aggResult.rxDroppedAgg:0) + addResult.addRxDropped;
    //                     newAggResult.txBytesAgg = (aggResult?aggResult.txBytesAgg:0) + addResult.addTxBytes;
    //                     newAggResult.txErrorsAgg = (aggResult?aggResult.txErrorsAgg:0) + addResult.addTxErrors;
    //                     newAggResult.txDroppedAgg = (aggResult?aggResult.txDroppedAgg:0) + addResult.addTxDropped;
    //
    //                     flowData[aggTime] = newAggResult;
    //                     try{
    //                         fs.writeFileSync(flowPath, JSON.stringify(flowData));
    //                     }catch(e){
    //                         return P.reject(e.message);
    //                     }
    //
    //                     return P.resolve({});
    //                 });
    //         }
    //     }).catch((e)=>{
    //         return P.reject(e);
    //     })
    // }


}
module.exports = NetInfo;
