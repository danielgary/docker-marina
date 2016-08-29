#!/usr/bin/env node
"use strict";
const args = require('args');
const fs = require('fs');
const sys = require('util');
const exec = require('child_process').exec;

args
    .option('i', 'The json file containing container definitions')

const flags = args.parse(process.argv);
console.log(flags);
if(flags.i){

    fs.readFile(flags.i, 'utf8', (e, c)=>{
        if(e){
            console.error(e);
        }
        else{
            var def = JSON.parse(c);
            
        }
        
    })

}

exec('docker run -e NODE_ENV=production -p 3000:3000 -d nys-statusform');