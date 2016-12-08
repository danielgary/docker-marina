#!/usr/bin/env node
"use strict";
const leftPad = require('left-pad');
const args = require('args');
const fs = require('fs');
const sys = require('util');
const exec = require('child_process').execSync;

const quote = /^win/.test(process.platform) ? '"' : "'";
console.log("Hola");
String.prototype.appendLine = function (newLine) {
    return this + '\n' + newLine;
}

args
    .option('i', 'The json file containing container definitions')
    .option('c', 'The container name to update. Otherwise all containers will be included');

const flags = args.parse(process.argv);



if (flags.i) {

    fs.readFile(flags.i, 'utf8', (e, c) => {
        if (e) {
            console.error(e);
        }
        else {
            var def = JSON.parse(c);
            generateNginxConfiguration(def.containers);
            startContainers(def.containers);
            startNginxContainer(def);

        }

    })

}

function startContainers(containers) {
    containers.map((c) => {

        if (flags.c && flags.c !== c.name)
            return;

        var ports = c.ports.map((p) => { return `-p ${p.public}:${p.private}` }).join(' ');
        var environment = Object.keys(c.environment).map((k) => {
            var v = c.environment[k];
            return `-e ${k}=${quote}${v}${quote}`;
        }).join(' ');

        var volumes = "";
        if (c.volumes) {
            volumes = Object.keys(c.volumes).map((k) => {
                var v = c.volumes[k];
                return `-v ${k}:${v}`;
            }).join(' ');
        }
        var links = ""
        if(c.links) {
          links = Object.keys(c.links).map((k)=>{
            var v = c.links[k]
            return `--link ${k}:${v}`
          }).join(' ')
        }

        var restartPolicy = '--restart=unless-stopped';

        var name = c.name;
        var image = c.image;


        //pull latest
        sh(`docker pull ${image}`);

        //stop existing container and remove it
        sh(`docker stop ${name}`);
        sh(`docker rm ${name}`);

        sh(`docker run -d ${ports} ${environment} ${links} ${volumes} ${restartPolicy} --name ${name} ${image}`)
    });
}

function startNginxContainer(def) {
    var ports = getNginxPorts(def.containers);
    var name = `${def.server_name}-nginx`;
    
    ports = ports
        .map((p) => { return `-p ${p}:${p}` })
        .join(' ');
    // ports += ' -p 443:443'


    //stop existing nginx and remove it
    sh(`docker stop ${name}`);
    sh(`docker rm ${name}`);

    // sh(`openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout cert.key -out cert.crt -batch`)

    //start new container
    sh(`docker run -d ${ports} --restart=always --name ${name} nginx`);
    sh(`docker cp ./nginx.conf ${name}:/etc/nginx/nginx.conf`);
    // sh(`docker cp ./cert.key ${name}:/etc/nginx/cert.key`);
    // sh(`docker cp ./cert.crt ${name}:/etc/nginx/cert.crt`);
    sh(`docker exec ${name} nginx -s reload`)
}


function sh(command) {
    try {
        console.log(command);
        exec(command);
    }
    catch (e) {

    }
}

function generateNginxConfiguration(containers) {
    var outfile = './nginx.conf';

    var body = 'user www-data;'
        .appendLine('worker_processes 6;')
        .appendLine('pid /var/run/nginx.pid;')
        .appendLine('events { worker_connections 1024; }')
        .appendLine('http {')
        .appendLine(`\tclient_max_body_size 100M;`)

    for (var i = 0; i < containers.length; i++) {
        if(containers[i].web){
          body = body.appendLine(generateServerFromContainer(containers[i]));
        }
        
    }

    body = body.appendLine('}');

    fs.writeFileSync("./nginx.conf", body);
}

function generateServerFromContainer(container) {
    var serverNames = container.web.server_names.join(' ');

    return "\tserver {"
        .appendLine(`\t\tlisten 80;`)
        .appendLine(`\t\tserver_name ${serverNames};`)

        .appendLine(`\t\tlocation / {`, 8)
        .appendLine(`\t\t\tproxy_set_header Host $host;`)
        .appendLine(`\t\t\tproxy_set_header X-Real-IP $remote_addr;`)
        .appendLine(`\t\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
        .appendLine(`\t\t\tproxy_set_header X-Forwarded-Proto $scheme;`)
        .appendLine(`\t\t\tproxy_pass ${container.web.location};`)
        .appendLine(`\t\t\tproxy_read_timeout 90;`)
        .appendLine('\t\t}')
        .appendLine('\t}');
}

function getNginxPorts(containers) {
    return containers.filter((c)=>{return c.web}).map((c) => {
      if(c.web)
        return c.web.listen;
    }).filter((p, i, self) => { return self.indexOf(p) === i; });
}