const iotBase = require('./iotBase');
const si = require('systeminformation');
const _ = require('lodash');
const P = require('bluebird');
const os = require('os');
const {execSync,exec} = require('child_process');

class DiskInfo extends iotBase{
    constructor(gw){
        super('diskInfo',gw,false);
    }

    startup(){
        if(os.type().toLowerCase() == "linux"){
            this.getInfo();
        }
        this.diskMonitor.on('add', (device) => {
            if (device.DEVTYPE == 'disk'){
                setTimeout(() =>{
                    this.getInfo()
                },2000);
            }
        });
        this.diskMonitor.on('remove', (device) => {
            if (device.DEVTYPE == 'disk'){
                this.getInfo();
            }
        });
        this.diskMonitor.on('change', (device) => {
            if (device.DEVTYPE == 'disk'){
                this.getInfo();
            }
        });

    }

    //分区挂载在根节点是系统盘
    //分区数量大于1或0是需格式化
    //分区数量是1，文件不是ext4是需要格式化
    //分区挂载点是/mnt/uuid 可以直接用，否则是需挂载
    getInfo(){
        // let cur_mount = execSync("df |grep /mnt/massdisk | awk '{print $1}'").toString() || ""
        // cur_mount=cur_mount.replace(/\s/g,"")
        return P.resolve().
        //     then(() =>{
        //     return this.getDisks()
        // })
        then(si.diskLayout).then(disks=>{
            let obj = {};

            _.each(disks,(item)=>{
                if(item.type.toLowerCase() == "hd"){
                    // var mounted = false
                    // if(cur_mount.indexOf(item.device)==0){
                    //     mounted = true;
                    // }
                    obj[item.device.substr(5,99)] = {
                        blocks:0,
                        type:item.type,
                        size:item.size,
                        device:item.device,
                        // state: mounted?"0":(this.dev == item.device?"1":"2")
                    };
                }
            });

            return (obj);
        })
            .then(disks=>{
            return si.blockDevices().then(result=>{
                return {disks:disks,blocks:result}
            })
        }).then(rawinfos=>{
            let disks = _.map(rawinfos.disks,(value,key)=>{
                let reg = new RegExp("^"+key)
                _.each(rawinfos.blocks,item =>{
                    if(reg.test(item.name) && item.type =="part"){
                        value.blocks += 1;
                        value.fstype = value.blocks == 1? item.fstype : "",
                        value.mount = value.blocks == 1? item.mount : "";
                        value.name = `/dev/${item.name}`
                        value.uuid = item.uuid

                    }

                });
                if(value.fstype != 'ext4' || value.blocks != 1){
                    value.state = 0;
                }
                else if(!value.mount) {
                    value.state = 1;
                }
                else {
                    value.state = 2;
                }

                return value
            });

            this.updateAttr("disks",disks);

        })
    }
    getDisks() {
        let result = execSync("lsblk -JO")

        let disks = JSON.parse(result)
        if (disks) {
            let disksInfos = disks.blockdevices;

            let diskPasred= {};
            for (let i= 0; i < disksInfos.length;i++) {
                this.buildDisk(diskPasred,disksInfos[i])
            }
            return diskPasred;
        }
    }

    /**
     * 分析disk，有三种状态:未知 "unknown"， 4，
     *                   系统盘 "system" 3
     *                   需要格式化 "toFormat" 0
     *                   可用（已经挂载）"mounted" 2
     *                   需挂载 1
     * @param {} result
     * @param {*} diskInfo
     */
    buildDisk(result,diskInfo){
        let diskState = 4
        let diskInfoName = null
        if(diskInfo.mountpoint){
            diskState = 4
        }else if(diskInfo.children  ) {
            for(let i = 0; i < diskInfo.children.length;i++){
                if(diskInfo.children[i].mountpoint == "/"){
                    diskState = 3
                    break;
                }
            }
            if (diskState != 3){
                if(diskInfo.children.length >1 || diskInfo.children.length== 0){
                    diskState = 0
                }else {

                    let part = diskInfo.children[0];
                    diskInfoName = diskInfo.name + "/" + part.name
                    if (part.fstype != "ext4"){
                        diskState = 0
                    }  else {
                        if (part.mountpoint && part.mountpoint.indexOf(part.uuid)>0) {
                            diskState = 2
                        }else{
                            diskState = 1
                        }
                    }
                }
            }
        }else{
            let diskSize = this.getDiskSize(diskInfo.size)
            if (diskSize < 536870912000){
                diskState = 4
            } else{
                diskState = 0
            }

        }
        //磁盘没有分区，磁盘有好几个分区
        if(diskState == 0 || diskState == 1 || diskState == 2){
            let diskSize = this.getDiskSize(diskInfo.size)
            result[('/dev/' + diskInfo.name).substr(5,99)]=
            {
                blocks:0,
                device:'/dev/' + diskInfo.name,
                size:diskSize,
                type:"HD",
            }
        }
    }

    getDiskSize(OrignDiskSize){
        let laststr = OrignDiskSize.substr(OrignDiskSize.length-1,1);
        let otherstr = OrignDiskSize.substr(0,OrignDiskSize.length-1);
        let diskSize
        if(laststr == 'T'){
            diskSize = otherstr * 1024*1024*1024*1024
        }else if(laststr == 'G'){
            diskSize = otherstr * 1024*1024*1024
        }else if(laststr == 'M'){
            diskSize = otherstr * 1024*1024
        }else if(laststr == 'K'){
            diskSize = otherstr * 1024
        }else{
            diskSize = OrignDiskSize * 1
        }
        return diskSize.toFixed(0);

    }

    createFs(diskName){
        if(this.dev){
            return P.reject('正在格式化 ${this.dev}')
        }
        this.dev = diskName;
        let eswarm = this.gateway.iots.eSwarm;
        return P.resolve().then(() =>{
            if (eswarm) {
                return eswarm.stop();
            }
            return P.resolve()
        }).then(() => {
            console.log(`Start to format ${diskName}`)
            execSync(`sudo ${process.cwd()}/sh/createfs.sh ${diskName}`)
            console.log(`create ${diskName} ok`)
            execSync(`${process.cwd()}/sh/updatefs.sh ${diskName}1`)
            return P.resolve()
        }).then(() =>{
            this.getInfo();
            return P.resolve()
        }).finally(()=>{
            eswarm.startup()
            this.dev = "";
        })
    }

    importFs(diskName){
        let eswarm = this.gateway.iots.eSwarm
        return P.resolve().then(() => {
            if (eswarm) {
                return eswarm.stop();
            }
            return P.resolve()
        }).then(() =>{
            execSync(`sudo ${process.cwd()}/sh/importfs.sh ${diskName}`)
            execSync(`${process.cwd()}/sh/updatefs.sh ${diskName}`)
        }).then(() => {
            return eswarm.startup();
        }).then(() =>{
            return this.getInfo()
        }).catch((e) =>{
            return P.reject(e)
        }).finally(() => {
            eswarm.startup()
        })
    }
}

module.exports = DiskInfo;