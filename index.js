const sys = require('sys');
const exec = require('child_process').exec;

exec('docker run -e NODE_ENV=production -p 3000:3000 -d nys-statusform');