const https = require('https');
const pem = require('pem');

// let pems = selfsigned.generate({ days: 365 });
//
// let httpsServer = https.createServer({
//     key: pems.key,
//     cert: pems.cert
// })

module.exports =  class wss {
    constructor(gateway){
        this.gateway = gateway;
    }

    startup(){

        pem.createCertificate({days:720,selfsigned:true},(err,keys)=>{
            let httpsServer = https.createServer({
                key: keys.serviceKey,
                cert: keys.certificate
            })
            this.io = require('socket.io')(httpsServer,{
                //path: '/test',
                //serveClient: false,
                // below are engine.IO options
                pingInterval: 130000,
                pingTimeout: 120000,
                //cookie: false
            });
            httpsServer.listen(8080,"0.0.0.0");

            this.io.on('connection', (ws) => {

                ws.on('message', (msg)=> {

                    if(msg.cmd == 'req'){
                        // let time1 = new Date()
                        this.gateway.rreq(msg).then((result)=>{
                            result.cmd = "rreq";
                            result.msgId = msg.msgId;

                            ws.emit('message',result)
                            // console.log("执行时间：",new Date() - time1)
                        })

                    }

                });

                //首次连接后发送所有状态
                let fistMsg = {
                    cmd:'status',
                    payload: this.gateway.getStatus()
                };

                ws.emit('message',fistMsg);
            });

            this.gateway.on('notify',(msg)=>{
                msg.cmd = "notify";
                this.io.emit('message',msg);
            })
        })


    }
}
