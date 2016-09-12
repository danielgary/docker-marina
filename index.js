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
        var name = c.name;
        var image = c.image;


        //pull latest
        sh(`docker pull ${image}`);

        //stop existing container and remove it
        sh(`docker stop ${name}`);
        sh(`docker rm ${name}`);

        sh(`docker run -d ${ports} ${environment} ${volumes} --name ${name} ${image}`)
    });
}

function startNginxContainer(def) {
    var ports = getNginxPorts(def.containers);
    var name = `${def.server_name}-nginx`;
    ports = ports
        .map((p) => { return `-p ${p}:${p}` })
        .join(' ');



    //stop existing nginx and remove it
    sh(`docker stop ${name}`);
    sh(`docker rm ${name}`);

    //start new container
    sh(`docker run -d ${ports} --name ${name} nginx`);
    sh(`docker cp ./nginx.conf ${name}:/etc/nginx/nginx.conf`);
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
        .appendLine('worker_processes 4;')
        .appendLine('pid /var/run/nginx.pid;')
        .appendLine('events { worker_connections 1024; }')
        .appendLine('http {')
        .appendLine(`\tclient_max_body_size 5M;`)

    for (var i = 0; i < containers.length; i++) {
        body = body.appendLine(generateServerFromContainer(containers[i]));
    }

    body = body.appendLine('}');

    fs.writeFileSync("./nginx.conf", body);
}

function generateServerFromContainer(container) {
    var serverNames = container.web.server_names.join(' ');

    return "\tserver {"
        .appendLine(`\t\tlisten ${container.web.listen};`)
        .appendLine(`\t\tserver_name ${serverNames};`)
        .appendLine(`\t\tlocation / {`, 8)
        .appendLine(`\t\t\tproxy_pass ${container.web.location};`)
        .appendLine('\t\t}')
        .appendLine('\t}');
}

function getNginxPorts(containers) {
    return containers.map((c) => {
        return c.web.listen;
    }).filter((p, i, self) => { return self.indexOf(p) === i; });
}