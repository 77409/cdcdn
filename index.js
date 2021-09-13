const wss = require("./wss");
const gateway = require("./gateway");
const Mult = require("./multicast");
const config = require("./package.json")
const process = require('process');

let init = ()=>{
    let gw = new gateway();
    let ss = new wss(gw);
    let mult = new Mult(gw);

    ss.startup();
    gw.startup();

    process.on('beforeExit', (code) => {
        _.each(gw.iots,(item,index)=>{
            item.killChildProcess()
        })
        console.log(`退出码: ${code}`);
    });

    setTimeout(()=>{
        try {
            mult.startup();
        }catch(e){
            console.log(e.message || e)
        }

    },10000)

    console.log("CDSC Deamon Version:",config.version);





};


init();