const _ = require('lodash');
const fs = require('fs');
const { execSync } = require('child_process');
const moment = require('moment');
const axios = require('axios');
const Config = require(`${process.cwd()}/config.json`);
const EventEmitter = require('events');
const P = require('bluebird');
const path = require('path');
const urljoin = require('url-join');
const crypto = require('crypto');

class appFlow extends EventEmitter{
    constructor(iots){
        super();
        this.iots = iots;
        //{iotId:{active:true,groupNum:XXX}}
        //哪些app计算流量
        this.apps = {};
        //{iotId:{old:{up:XX,down:XX}},new:{up:XX,down:XX}},iotID2:{old:XX,new:XX}}
        //记录流量原始数据
        this.aggObj = {};
        this.colNum = 0;
        //初始化this.apps，this.aggObj
        _.each(this.iots,(iot,index)=>{
            if (iot.isApp){
                this.apps[iot.iotId] = {
                    active : true,
                    groupNum : parseInt('0x'+iot.cgroup,16)
                };
                this.aggObj[iot.iotId] = {old:-1,new:-1};
            }
        });
    }

    startup(){
        //1.新建cgroup 2.将进程加入到cgroup
        let iotIds = _.keys(this.apps);
        _.each(iotIds,(iotId,index)=>{
            this.addCGroup(iotId,this.apps[iotId].groupNum);
            this.addProcess(iotId, this.iots[iotId].getPids());

        })
        _.each(this.iots,(item,index)=>{
            item.on('addProcess',(iotId,pids)=>{
                if (item.isApp) {
                    this.addProcess(iotId, pids);
                }

            })
        })
        // //删除aqy进程
        // let aqypath = '/sys/fs/cgroup/net_cls/aqyInfo';
        // if(fs.existsSync(aqypath)){
        //     let result = execSync('cat /sys/fs/cgroup/net_cls/aqyInfo/cgroup.procs').toString();
        //     if (result) {
        //         try{
        //             execSync('systemctl restart ipes');
        //         }catch (e) {
        //             console.log('restart ipes error:',e.message);
        //         }
        //
        //     }
        // }

        //每隔固定时间检测流量
        this.cycleCheck();
    }

    addCGroup(appKey,groupNum){
        let path = '/sys/fs/cgroup/net_cls/' + appKey;
        if(!fs.existsSync(path)){
            //fs.mkdirSync(path);
            try{
                execSync('mkdir ' + path);
                execSync('echo '+groupNum+' > '+path + '/net_cls.classid');
                execSync('iptables -A INPUT -p all -m cgroup --cgroup '+groupNum+' -j ACCEPT');
                execSync('iptables -A OUTPUT -p all -m cgroup --cgroup '+groupNum+' -j ACCEPT');
            }catch (e) {
                console.log(e.message);
            }

        }
    }
    //给appKey的CGroup添加进程
    addProcess(appKey,pids){
        let path = '/sys/fs/cgroup/net_cls/'+appKey;
        if (fs.existsSync(path) && pids && pids.length > 0){
            _.each(pids,(pid)=>{
                try{
                    console.log('add process:','echo '+pid + ' >> '+path + '/cgroup.procs');
                    execSync('echo '+pid + ' >> '+path + '/cgroup.procs');
                }catch (e) {
                    console.log(e.message)
                }

            })
        }
    }
    //读取上传下载数据
    //{
    //   INPUT: { '2': '526147', '4097': '33593411376' },
    //   OUTPUT: { '2': '11358599775', '4097': '113893908102' }
    // }
    readFlow(){
        let result = execSync(`iptables -nvxL |awk '{print $2,$11}'`).toString();
        let results = _.map(result.split('\n \n').filter((item)=>/^INPUT|^OUTPUT/.test(item)),(item,index)=>{
            return item.split('\n').filter((item)=> item != ''&&item != ' ');
        })
        let resultObj = {}
        _.each(results,(item,index)=>{
            let innerObj = {};
            _.each(item,(innerItem ,innerIndex)=>{
                if (innerIndex > 1){
                    let arr = innerItem.split(' ');
                    innerObj[arr[1]] = arr[0];
                }
            })
            resultObj[item[0].trim()] = innerObj;
        })
        return resultObj
    }
    //每隔固定时间检测流量
    //{时间：{appKey:{up:XX,down:XX},appKey2:{up:XX,down:XX}}}
    cycleCheck(){
        let beginTime = null;
        let flowPath = path.join(process.cwd(), "processFlow.json");
        let url =  urljoin(Config.baseUrl,"flow");
        P.resolve().then(() => {
            beginTime = this.getBeginTime();
            //1.获取流量orignObj
            let iotIds = _.keys(this.aggObj);
            let orignObj = this.readFlow();
            //2.获取流量对象aggObj
            let flowObj = {}
            let flowall = {allin:0,allout:0};
            _.reduce(iotIds,(result,iotId,index)=>{
                //---------读取iotId对应的流量-----------------
                let newAgg = {};
                _.each(orignObj,(value,key)=>{
                    let okey = parseInt('0x'+this.iots[iotId].cgroup,16);
                    newAgg[key] = value[okey];
                })
                this.aggObj[iotId].new = newAgg;
                if(this.aggObj[iotId].old != -1){
                    let appflow = {}
                    appflow.in = this.aggObj[iotId].new.INPUT - this.aggObj[iotId].old.INPUT;
                    appflow.in = appflow.in > 0 ? appflow.in : 0;
                    appflow.out = this.aggObj[iotId].new.OUTPUT - this.aggObj[iotId].old.OUTPUT;
                    appflow.out = appflow.out > 0 ? appflow.out : 0;
                    if (appflow.in || appflow.out){
                        let iotflow = {}
                        iotflow[this.iots[iotId].appName] = appflow;
                        _.extend(flowObj,iotflow)
                    }
                    result.allin +=  appflow.in;
                    result.allout += appflow.out;
                }
                this.aggObj[iotId].old = this.aggObj[iotId].new;
                return result;
            },flowall)
            this.iots.netInfo.updateAttr("rxSec",Math.round(flowall.allin / 300));
            this.iots.netInfo.updateAttr("txSec",Math.round(flowall.allout / 300));
            //3.上报流量对象data,
            let uploadObj = this.readFlowData(flowPath);
            //判断flowObj是否是空对象,空对象不上传
            if (!_.isEmpty(flowObj)){
                uploadObj[beginTime.clone().subtract(5,'minutes').format('YYYY-MM-DD HH:mm:ss Z')] = flowObj;
            }
            let data = {uuid:this.iots.sysInfo.attributes.sUUID,flow:uploadObj,signVersion:'1.0.0'};
            data.sign = this.cryptFlow(data);
            this.colNum ++;
            return data;
        }).then((data)=>{
            let ranTime = Math.floor(Math.random() * 180000);
            return new P((reslove)=>{
                setTimeout(()=>{
                    reslove()
                },0)
            }).then(()=>{
                return data;
            })
        }).then((data)=>{
            let isupload = this.colNum % _.toNumber(Config.uploadColNum || "1") == 0;
            this.colNum = isupload ? 0 : this.colNum;
            if (url && data.uuid && !_.isEmpty(data.flow) && isupload) {
                if (isupload) {
                    return axios.post(url,data,{timeout: 10000}).then((response)=>{
                        if (response.status == 200 && response.data && response.data.sign == data.sign){
                            //上报成功清空文件
                            //console.log('返回200：',response.data);
                            fs.writeFileSync(flowPath, JSON.stringify({}));
                        }else{
                            //上报不成功记录流量
                            //console.log('返回非200：',response.data);
                            this.writeFlowData(data.flow,flowPath);
                        }
                    }).catch((e)=>{
                        console.log('upload flow fail:',e.message);
                        //上报不成功记录流量
                        this.writeFlowData(data.flow,flowPath);
                    })
                }else{
                    this.writeFlowData(data.flow,flowPath);
                }
            }

        }).catch(e=>{
            console.error(e.message);
        }).finally(()=>{
            //4.计算距离下个时间点的时间
            let time = beginTime.clone().add(5,'minutes').diff(moment());
            setTimeout(() => {
                this.cycleCheck();
            },time);
        });
    }

    getBeginTime(){
        let now = moment();
        let minute = now.minute();
        let diff = minute % 5;
        return moment([now.year(),now.month(),now.date(),now.hour(),minute-diff,0,0])
    }
    // getIndex(){
    //     let now = moment();
    //     let index =  _.floor((now.hour() * 60 + now.minute()) / 5);
    //     console.log('index',index);
    //     return index;
    // }
    // getNextIndex(){
    //     let index = this.getIndex();
    //     return index == 287 ? 0 : index+1;
    // }
    // getBeforeIndex(){
    //     let index = this.getIndex();
    //     return index == 0 ? 287 : index-1;
    // }
    // getAggTime(){
    //     let now = moment();
    //     let beforeNow = null;
    //     let beforeIndex = this.getBeforeIndex();
    //     if (beforeIndex == 287){
    //         let beforeDay = moment().sub(1,'days');
    //         beforeNow = moment([beforeDay.year(),beforeDay.month(),beforeDay.date(),23,55,0,0])
    //         console.log('beforeNow',beforeNow.toDate())
    //     }else{
    //         let beforeHour = _.floor(beforeIndex/12);
    //         let beforeMinute = _.toNumber(beforeIndex%12)*5;
    //         beforeNow = moment([now.year(),now.month(),now.date(),beforeHour,beforeMinute,0,0])
    //         console.log('nextNow',beforeNow.toDate())
    //     }
    //     return beforeNow
    // }
    //
    // getSubTime(){
    //     let now = moment();
    //     let nextNow = null;
    //     let nextIndex = this.getNextIndex();
    //     if (nextIndex == 0){
    //         let nextDay = moment().add(1,'days');
    //         nextNow = moment([nextDay.year(),nextDay.month(),nextDay.date(),0,0,0,0])
    //         console.log('nextNow',nextNow.toDate())
    //     }else{
    //         let nextHour = _.floor(nextIndex/12);
    //         let nextMinute = _.toNumber(nextIndex%12)*5;
    //         nextNow = moment([now.year(),now.month(),now.date(),nextHour,nextMinute,0,0])
    //         console.log('nextNow',nextNow.toDate())
    //     }
    //     let subTime = nextNow.diff(now);
    //     console.log('subTime',subTime)
    //     return subTime
    // }
    writeFlowData(uploadObj,flowPath){
        try{
            fs.writeFileSync(flowPath, JSON.stringify(uploadObj));
        }catch(e){
            return P.reject(e.message);
        }
    }
    readFlowData(flowPath){
        let flowData = {};
        if (fs.existsSync(flowPath)){
            let data
            try{
                data = fs.readFileSync(flowPath);
            }catch(e){
                console.log('processFlow.json文件读取不了：',e);
                fs.unlinkSync(flowPath);
                return P.reject(e.message);
            }
            try {
                flowData = JSON.parse(data.toString());
            } catch (e) {
                console.log('JSON文件转换不了：',e);
                fs.unlinkSync(flowPath);
                return P.reject(e.message);
            }
        }
        //取对象的前47个值
        let result = {};
        if(!_.isEmpty(flowData)){
            let keyarr = _.keys(flowData);
            let newKeyArr = _.takeRight(keyarr,575);
            _.each(newKeyArr,(item,index)=>{
                result[item] = flowData[item];
            })
            return result;
        }
        return flowData;
    }
    cryptFlow({uuid,flow}){
        let sumTime = 0, sumIn = 0, sumOut = 0;
        _.each(flow,(item,date)=>{
            let dt = moment(date,'YYYY-MM-DD HH:mm:ss Z');
            if(!dt.isValid()){
                return;
            }
            sumTime +=dt.toDate().getTime();
            _.each(item,(flow,app)=> {
                if (flow.in && flow.out) {
                    sumIn += flow.in;
                    sumOut += flow.out;
                }
            })
        })
        let sumString = uuid + sumTime.toFixed(0)+sumIn.toFixed(0)+sumOut.toFixed(0);
        let hash = crypto.createHash('md5').update(sumString).digest("hex");
        return hash
    }
}

module.exports = appFlow;
