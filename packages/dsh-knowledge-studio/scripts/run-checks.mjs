import {spawn} from 'node:child_process'
const child=spawn(process.execPath,['--test','test/*.test.mjs',...process.argv.slice(2)],{stdio:'inherit',env:process.env,windowsHide:true})
child.on('exit',code=>process.exitCode=code??1)
child.on('error',error=>{console.error(error);process.exitCode=1})
