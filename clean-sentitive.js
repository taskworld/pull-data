#!/usr/bin/env node
'use strict'
const Readline = require('readline')
const rl = Readline.createInterface({
  input: process.stdin
})
rl.on('line', data => {
  if (/,message:task:create/.test(data)) {
    process.stdout.write(
      data.replace(/:message:.*?:hasAttachment:(true)?/, '') + `\n`
    )
  } else {
    process.stdout.write(data + `\n`)
  }
})
process.stdin.resume()
