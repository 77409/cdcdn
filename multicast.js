const dgram = require('dgram');
const os = require('os');

let MutilAddr = '224.0.0.110';

class Muticast {
    constructor(gateway){
        this.gateway = gateway;

    }

    startup(){
        this.mutiServer = dgram.createSocket({type:'udp4',reuseAddr:true});

        this.mutiServer.on('message', (data, rInfo) => {
            let cmdObj;

            try{
                cmdObj = JSON.parse(data.toString());
            }
            catch (e){
                cmdObj={};
            }

            let client = dgram.createSocket({type:'udp4',reuseAddr:true});

            if(cmdObj.cmd == 'findMiner'){
                let bzzaccount = null
                if (this.gateway.iots.eSwarm.attributes.config) {
                    bzzaccount = this.gateway.iots.eSwarm.attributes.config.bzzaccount
                }
                let msg = {
                    sUUID:this.gateway.iots.sysInfo.attributes.sUUID,
                    bzzaccount: bzzaccount,
                    https:true,
                    port:8080,
                    cpuInfo:this.gateway.iots.sysInfo.attributes.cpuBrand,
                    memoryInfo:this.gateway.iots.sysInfo.attributes.totalMem,
                };

                client.send(JSON.stringify(msg), 60010,rInfo.address,()=>{
                    client.close();
                })
            }
        });

        this.mutiServer.on('listening', () => {
            let networkIfaces = os.networkInterfaces();
            for (let ifaceName in networkIfaces) {
                let networkIface = networkIfaces[ifaceName];

                for (let connection of networkIface) {
                    if (connection.family === 'IPv4') {
                        try {
                            this.mutiServer.dropMembership(MutilAddr, connection.address)
                        }catch(e){
                            console.log("error in drop membership",e.message || e)
                        }

                        try {
                         this.mutiServer.addMembership(MutilAddr, connection.address)
                        }catch(e){
                            console.log("error in add membership",e.message || e)
                        }
                    }
                }
            }

        });
        this.mutiServer.bind(60009,"0.0.0.0");
    }
}

module.exports = Muticast;