#!/usr/bin/env node
"use strict";


const leftPad = require('left-pad');
const args = require('args');
const fs = require('fs');
const sys = require('util');
const exec = require('child_process').execSync;
const spawn = require('child_process').spawnSync;

const quote = /^win/.test(process.platform) ? '"' : "'";
console.log("Hola");
String.prototype.appendLine = function (newLine) {
  return this + '\n' + newLine;
}

args
  .option('i', 'The json file containing container definitions')
  .option('c', 'The container name to update. Otherwise all containers will be included')
  .option('e', 'Set expiry time for static files')
  .option('n', 'Ignore containers, just rebuild nginx');

const flags = args.parse(process.argv);



if (flags.i) {

  fs.readFile(flags.i, 'utf8', (e, c) => {
    if (e) {
      console.error(e);
    }
    else {
      var def = JSON.parse(c);

      generateNginxConfiguration(def.containers);
      if (!flags.n) {
        startContainers(def.containers);
      }
      startNginxContainer(def);

    }

  })

}

function startContainers(containers) {
  containers.map((c) => {

    if (flags.c && flags.c !== c.name)
      return;

    var network = ''
    if (c.network) {
      network = `--net=${c.network}`
    }

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
    if (c.links) {
      links = Object.keys(c.links).map((k) => {
        var v = c.links[k]
        return `--link ${k}:${v}`
      }).join(' ')
    }

    var restartPolicy = '--restart=unless-stopped';


    var name = c.name;
    var image = c.image;
    var tag = c.tag || 'latest'

    //pull latest
    sh(`docker pull ${image}:${tag}`);

    //stop existing container and remove it
    sh(`docker stop ${name}`);
    sh(`docker rm ${name}`);


    sh(`docker run -d ${network} ${ports} ${environment} ${links} ${volumes} ${restartPolicy} --name ${name} ${image}:${tag}`)

    //if container def indicates container should receive configuration, do so
    if (c.includeConfiguration) {
      sh(`docker cp ${flags.i} ${name}:/docker-marina.json`)
    }
    if (c.installDockerMarina) {
      sh(`docker exec ${name} npm i -g docker-marina`)
    }
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
  sh(`docker pull gatewayapps/ims-nginx`)
  sh(`docker run -d ${ports} --restart=always --name ${name} gatewayapps/ims-nginx`);
  sh(`mkdir temp`)
  sh(`docker exec ${name} mkdir -p /data`)
  for (var i = 0; i < def.containers.length; i++) {
    var c = def.containers[i]
    if (c.clientFiles) {
      sh(`mkdir temp/${c.name}`)
      sh(`docker cp ${c.name}:${c.clientFiles} ./temp/${c.name}`)


      sh(`docker cp ./temp/${c.name}/ ${name}:/data/${c.name}/`)
      sh(`docker exec ${name} chown -R www-data /data/${c.name}`)
    }
  }

  sh(`rm -rf temp`)

  sh(`docker cp ./nginx.conf ${name}:/etc/nginx/nginx.conf`);

  // sh(`docker cp ./cert.key ${name}:/etc/nginx/cert.key`);
  // sh(`docker cp ./cert.crt ${name}:/etc/nginx/cert.crt`);
  sh(`docker exec ${name} supervisorctl restart nginx`)
}


function sh(command) {

  try {
    console.log(command);
    var result = exec(command);


  }
  catch (e) {

  }
}

function sp(command) {
  try {
    console.log(command);
    spawn(command);
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
    .appendLine(`\tclient_max_body_size 1000M;`)
    .appendLine(`\tinclude  /opt/openresty/nginx/conf/mime.types;`)
    .appendLine('\tgzip              on;')
    .appendLine('\tgzip_buffers      16 8k;')
    .appendLine('\tgzip_comp_level   4;')
    .appendLine('\tgzip_http_version 1.0;')
    .appendLine('\tgzip_min_length   1280;')
    .appendLine('\tgzip_types        text/plain text/css application/javascript text/html application/x-javascript text/xml application/xml application/xml+rss text/javascript image/x-icon image/bmp;')
    .appendLine('\tgzip_vary         on;')

  for (var i = 0; i < containers.length; i++) {
    if (containers[i].web) {
      body = body.appendLine(generateServerFromContainer(containers[i]));
    }

  }

  body = body.appendLine('}');
  for(var i=0;i<containers.length;i++){
    if(containers[i].stream) {

    }
  }

  fs.writeFileSync("./nginx.conf", body);
}

function generateStreamFromContainer(index, container){
  var listen = container.stream.listen
  var forwardPort = container.stream.forward_port
  var serverName = container.stream.server_name

  return "\tserver {"
    .appendLine(`\t\tlisten ${listen};`)
    .appendLine(`\t\tproxy_connect_timeout 1s;`)
    .appendLine(`\t\tproxy_timeout 3s;`)
    .appendLine(`\t\tproxy_pass stream_${index};`)
    .appendLine(`\t\}`)
    .appendLine(`\tupstream stream_${index} {`)
    .appendLine(`\t\tserver ${serverName}:${forwardPort}`)
    .appendLine(`\t}`)
}

function generateServerFromContainer(container) {
  var serverNames = container.web.server_names.join(' ');

  var result = "\tserver {"
    .appendLine(`\t\tlisten 80;`)
    .appendLine(`\t\tserver_name ${serverNames};`)
    .appendLine(`\t\terror_log /var/log/nginx/${container.name}_error.log;`)
    .appendLine(`\t\taccess_log /var/log/nginx/${container.name}_access.log;`)
  if (container.clientFiles) {
    const expiryTime = flags.e || '1h'
    result = result
      .appendLine(`\t\troot /data/${container.name}/app;`)
      .appendLine(`\t\tindex index.html;`)
    result = result.appendLine(`\t\tlocation @api {`)
      .appendLine(`\t\t\tproxy_set_header Host $host;`)
      .appendLine(`\t\t\tset_by_lua $expires_time 'return ngx.cookie_time(ngx.time()+31536000)';`)
			.appendLine(`\t\t\tadd_header Set-Cookie "HUB_URL=${encodeURIComponent(container.environment.HUB_URL)};Path=/;expires=$expires_time;Max-Age=31536000";`)
      .appendLine(`\t\t\tadd_header X-UA-Compatible "IE=Edge";`)
      .appendLine(`\t\t\tproxy_set_header X-Real-IP $remote_addr;`)
      .appendLine(`\t\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
      .appendLine(`\t\t\tproxy_set_header X-Forwarded-Proto $scheme;`)
      .appendLine(`\t\t\tproxy_pass ${container.web.location};`)
      .appendLine(`\t\t\tproxy_read_timeout 5m;`)
      .appendLine(`\t\t\tproxy_buffer_size 16k;`)
      .appendLine(`\t\t\tproxy_buffers 8 32k;`)
      .appendLine(`\t\t\tproxy_busy_buffers_size 32k;`)
      .appendLine('\t\t}')
    result = result.appendLine(`\t\tlocation / {`)
      .appendLine(`\t\t\tset_by_lua $expires_time 'return ngx.cookie_time(ngx.time()+31536000)';`)
			.appendLine(`\t\t\tadd_header Set-Cookie "HUB_URL=${encodeURIComponent(container.environment.HUB_URL)};Path=/;expires=$expires_time;Max-Age=31536000";`)
      .appendLine(`\t\t\tadd_header X-UA-Compatible "IE=Edge";`)
      .appendLine(`\t\t\ttry_files $uri $uri/index.html @api;`)
      .appendLine(`\t\t\texpires ${expiryTime};`)
      .appendLine(`\t\t}`)

  } else {
    result = result.appendLine(`\t\tlocation / {`)
      .appendLine(`\t\t\tproxy_set_header Host $host;`)
      .appendLine(`\t\t\tset_by_lua $expires_time 'return ngx.cookie_time(ngx.time()+31536000)';`)
			.appendLine(`\t\t\tadd_header Set-Cookie "HUB_URL=${encodeURIComponent(container.environment.HUB_URL)};Path=/;expires=$expires_time;Max-Age=31536000";`)
      .appendLine(`\t\t\tadd_header X-UA-Compatible "IE=Edge";`)
      .appendLine(`\t\t\tproxy_set_header X-Real-IP $remote_addr;`)
      .appendLine(`\t\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
      .appendLine(`\t\t\tproxy_set_header X-Forwarded-Proto $scheme;`)
      .appendLine(`\t\t\tproxy_pass ${container.web.location};`)
      .appendLine(`\t\t\tproxy_read_timeout 5m;`)
      .appendLine(`\t\t\tproxy_buffer_size 16k;`)
      .appendLine(`\t\t\tproxy_buffers 8 32k;`)
      .appendLine(`\t\t\tproxy_busy_buffers_size 32k;`)
      .appendLine('\t\t}')
  }

  result = result.appendLine('\t}');

  return result
}

function getNginxPorts(containers) {
  return containers.filter((c) => { return c.web }).map((c) => {
    if (c.web)
      return c.web.listen;
  }).filter((p, i, self) => { return self.indexOf(p) === i; });
}