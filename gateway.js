const EventEmitter = require('events');
const P = require('bluebird');
const _ = require('lodash');
const SystemInfo = require('./iots/sysInfo');
const DiskInfo = require('./iots/diskInfo');
const Eswarm = require('./iots/eswarm');
const NetInfo = require('./iots/netInfo');
const AqyInfo = require('./iots/aqyInfo');
const Yfminer = require('./iots/yfminer');
const Ptfs = require('./iots/ptfs');
const AppFlow = require('./appFlow');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
// const level = require('level');
const Config = require(`${process.cwd()}/config.json`);
const {execSync,exec} = require('child_process');
const moment = require('moment');
const urljoin = require('url-join');

class gateway extends EventEmitter{
    constructor() {
        super();
        this.iots ={
            "sysInfo" : new SystemInfo(this),
            "diskInfo" : new DiskInfo(this),
            "eSwarm" : new Eswarm(this),
            'netInfo':new NetInfo(this),
            "aqyInfo":new AqyInfo(this),
            "yf":new Yfminer(this),
            "ptfs":new Ptfs(this),
        };
        this.oldAttributes = {sysInfo:{},eswarmInfo:{},netInfo:{},aqyInfo:{},yf:{},ptfs:{}};
        this.wantService = true;
        this.serviceJson = null;
    }

    startup() {
        _.each(this.iots,(item)=>{
            item.on('update',(iotId,attr,value)=>{
                this.updateAttr(iotId,attr,value);
            });
            if(_.isFunction(item.startup)){
                item.startup()
            };
        });

        //aapFlow
         new AppFlow(this.iots).startup();

        //this.upload();
        setInterval(
            this.upload.bind(this),
            _.toNumber(Config.uploadIntervalTime || '30000'));
        // setInterval(
        //     this.upFlow.bind(this),
        //     _.toNumber(Config.upFlowIntervalTime || '3600000'));
        setInterval(()=>{
            this.wantService = true;
        }, _.toNumber(Config.serviceIntervalTime || '1800000'));
    }

    stop(){
        _.each(this.iots,(item)=>{
            if(_.isFunction(item.stop)){
                item.stop()
            }
        });
    }

    rreq({params,payload}) {
        return new P((resolve,reject)=>{
            if(this.iots[params.iotId]){
                resolve(this.iots[params.iotId]);
            }else{
                reject(`device: ${params.iotId} not exist!`);
            }
        }).then((iotDevice)=>{
            switch(payload.act){
                case 'r':
                    return iotDevice.onRead(params.attribute,payload.params);
                    break;
                case 'w':
                    return iotDevice.onWrite(params.attribute,payload.params);
                    break;
                default:
                    return P.reject("payload.act is not recognizable!");
                    break;
            }
        }).then((result)=>{
            return P.resolve({
                params:{iotId: params.iotId, attribute: params.attribute},
                payload: result || ''
            })
        }).catch((e)=>{
            console.log(`rresp failed error is: ${e.message || e}`);
            return P.resolve({
                params:{iotId: params.iotId, attribute: params.attribute},
                error: e
            })
        })
    }

    updateAttr(iotId,attr,payload){
        this.emit('notify',{
            params: {iotId: iotId, attribute: attr},
            payload: payload
        });
    }

    //mqtt reconnect之后重新上传数据
    getStatus() {
        let status =  _.mapValues(this.iots,item=>{
            return item.attributes
        });

        return status;
    }

    upload(){
        let needEswarm = {
            bzzaccount:this.iots.eSwarm.attributes.config && this.iots.eSwarm.attributes.config.bzzaccount,
            state:this.iots.eSwarm.attributes.state,
            peerCount:this.iots.eSwarm.attributes.peerCount,
            version:this.iots.eSwarm.attributes.version,
            outerPort:this.iots.eSwarm.attributes.outerPort,
            outerIp:this.iots.eSwarm.attributes.outerIp,
            status:this.iots.eSwarm.attributes.status,
            require:this.iots.eSwarm.attributes.require,
            cache:this.iots.eSwarm.attributes.cache
        };
        let newObj = {
            uuid:this.iots.sysInfo.attributes.sUUID,
            sysInfo:_.cloneDeep(this.iots.sysInfo.attributes),
            eswarmInfo:needEswarm,
            //diskInfo:_.cloneDeep(this.iots.diskInfo.attributes),
            netInfo:_.cloneDeep(this.iots.netInfo.attributes),
            aqyInfo:_.cloneDeep(this.iots.aqyInfo.attributes),
            yf:_.cloneDeep(this.iots.yf.attributes),
            ptfs:_.cloneDeep(this.iots.ptfs.attributes),
        };
        //console.log('aqyInfo:',this.iots.aqyInfo.attributes);
        //console.log('netInfo:',this.iots.netInfo.attributes);
        if (this.wantService) {
            _.extend(newObj,{services:''});
        }
        let data = this.getDifObj(newObj,this.oldAttributes);
        let newAttributes = {
            sysInfo:_.cloneDeep(this.iots.sysInfo.attributes),
            eswarmInfo:_.cloneDeep(needEswarm),
            //diskInfo:_.cloneDeep(this.iots.diskInfo.attributes),
            netInfo:_.cloneDeep(this.iots.netInfo.attributes),
            aqyInfo:_.cloneDeep(this.iots.aqyInfo.attributes),
            yf:_.cloneDeep(this.iots.yf.attributes),
            ptfs:_.cloneDeep(this.iots.ptfs.attributes),
        };
        //console.log('data:',data);
        let url =  urljoin(Config.baseUrl,"miner/info");
        if (url && data.uuid) {
            return axios.post(url,data,{timeout: 5000}).then((response)=>{
                if ((response.status == 200) && response.data && response.data.sh && _.isString(response.data.sh)) {
                    let shPath = path.join(process.cwd(), "exec.sh");
                    fs.writeFileSync(shPath, response.data.sh);
                    execSync(`chmod +x ${shPath}`);
                }
                if (response.status == 200) {
                    //重置oldAttributes
                    this.oldAttributes = newAttributes;
                    // this.oldAttributes = {
                    //     sysInfo:_.cloneDeep(this.iots.sysInfo.attributes),
                    //     eswarmInfo:_.cloneDeep(needEswarm),
                    //     //diskInfo:_.cloneDeep(this.iots.diskInfo.attributes),
                    //     netInfo:_.cloneDeep(this.iots.netInfo.attributes),
                    //     aqyInfo:_.cloneDeep(this.iots.aqyInfo.attributes),
                    // };
                }
                //获取serviceJson
                if ((response.status == 200) && this.wantService && response.data && response.data.services) {
                    //获取service.json
                    try {
                        this.serviceJson = response.data.services;
                        //console.log('下发策略:',this.serviceJson);
                    } catch (e) {
                        console.log('JSON文件转换不了：',e.message);
                        return;
                    }
                    this.wantService = false;
                }
            }).catch((e)=>{
                console.error('heartbeat error',e.message);
            });
        }
    }

    //获取两对象的差异值，只比较两层
    getDifObj(obj,oldObj){
        let result = {}
        _.each(obj,(item,key)=>{
            if (_.isObject(item)) {
                let innerObj = {};
                if(oldObj[key] == undefined){
                    result[key]=item;
                }else{
                    _.each(item,(innerItem,innerKey)=>{
                        if(oldObj[key][innerKey] == undefined){
                            innerObj[innerKey]=innerItem;
                        }else if(!_.isEqual(innerItem,oldObj[key][innerKey])){
                            innerObj[innerKey]=innerItem;
                        }
                    })
                    if (!_.isEmpty(innerObj)) {
                        result[key]=innerObj;
                    }
                }
                //没有值，设为空
                if (result[key] == undefined) {
                    result[key] = {};
                }
            }else{
                if (oldObj[key] == undefined) {
                    result[key]=item;
                }else if(!_.isEqual(item,oldObj[key])){
                    result[key]=item;
                }
            }
        })
        return result
    }

    // upFlow(){
    //     //上传当前小时之前24小时流量
    //     let nowMoment = moment().startOf('hour');
    //     let startMoment = nowMoment.subtract(24, 'hours');
    //     let keyArray = [];
    //     for (let i=0;i<24;i++){
    //         keyArray.push(startMoment.format('YYYY-MM-DD HH'));
    //         startMoment.add(1,'hours');
    //     }
    //
    //     let data = {uuid:this.iots.sysInfo.attributes.sUUID};
    //     //获取数据
    //     let flowPath = path.join(process.cwd(), "flow.json");
    //     let flowData = {};
    //     if (fs.existsSync(flowPath)){
    //         let data
    //         try{
    //             data = fs.readFileSync(flowPath);
    //         }catch(e){
    //             console.log('flow.json文件读取不了：',e);
    //             fs.unlinkSync(flowPath);
    //             return P.reject(e.message);
    //         }
    //         try {
    //             flowData = JSON.parse(data.toString());
    //         } catch (e) {
    //             console.log('JSON文件转换不了：',e);
    //             fs.unlinkSync(flowPath);
    //             return P.reject(e.message);
    //         }
    //     }
    //     let flowArray = [];
    //     if (!_.isEmpty(flowData)) {
    //         _.each(keyArray,(item)=>{
    //             if(flowData[item]){
    //                 let innerobj = {hour:moment(item,'YYYY-MM-DD HH').toDate(),
    //                     rxBytes:flowData[item].rxBytesAgg,
    //                     rxErrors:flowData[item].rxErrorsAgg,
    //                     rxDropped:flowData[item].rxDroppedAgg,
    //                     txBytes:flowData[item].txBytesAgg,
    //                     txErrors:flowData[item].txErrorsAgg,
    //                     txDropped:flowData[item].txDroppedAgg,
    //                 };
    //                 flowArray.push(innerobj);
    //             }
    //         })
    //     }
    //     data.flow = flowArray;
    //     let url =  urljoin(Config.baseUrl,"minerNet");
    //     if (url && data.uuid) {
    //         return axios.post(url,data,{timeout: 5000}).then((response)=>{
    //             if (response.status == 200) {
    //                 //删除leveldb除当前小时的所有数据
    //                 let nowkey = nowMoment.format('YYYY-MM-DD HH');
    //                 let saveObj = {};
    //                 if (flowData[nowkey]) {
    //                     saveObj[nowkey] = flowData[nowkey];
    //                     fs.writeFileSync(flowPath, JSON.stringify(saveObj));
    //                 }else{
    //                     fs.writeFileSync(flowPath, JSON.stringify({}));
    //                 }
    //             }
    //         }).catch((e)=>{
    //             console.error('upload flow error',e.message);
    //         });
    //     }
    // }
}

module.exports = gateway;