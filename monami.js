'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Exec = require('child_process').exec

setTimeout(run, 2500)

function run () {
  console.log('Running monami:', new Date())

  const fields = [
    'ts',
    'cpuPer',
    'memPer',
    'memVirtual',
    'memReal',
    'command'
    // 'memVirtual2',
    // 'memReal2',
    // 'cpuPer2',
    // 'memPer2'
  ]

  return getPsStats()
  .then(psStats => {
    // console.log('PS Stats:', psStats)
    // const fullStats = addTopStats(psStats)

    return Object.keys(psStats)
    .filter(pid => psStats[pid].cpuPer > 0 || psStats[pid].memPer > 0)
    .map(pid => {
      const stats = psStats[pid]
      return fields.map(x => stats[x]).join(`\t`)
    })
  })
  .then(report => {
    return new P((resolve, reject) => {
      console.log(`Writing ${report.length} report rows.`)
      const ws = Fs.createWriteStream('/tmp/performance-log.txt', { flags: 'a' })
      ws.end(report.join(`\n`) + `\n`, err => {
        if (err) {
          console.error('Error:', err)
          return reject(err)
        }
        resolve()
      })
    })
  })
  .finally(() => {
    console.log('It’s a Done Deal.')
    setTimeout(run, 5000)
  })
}

function addTopStats (psStats) {
  const topText = Fs.readFileSync(Path.join(__dirname, 'ubuntu-top.txt'), 'utf8')
  const topLines = topText.trim().split(/[\n\r]+/)

  let start = false
  return topLines.reduce((acc, x) => {
    if (x.indexOf('  PID ') === 0) {
      start = true
      return acc
    }
    if (x.indexOf('top - ') === 0) {
      start = false
    }
    if (!start) {
      return acc
    }

    const parts = x.trim().split(/[\s\t]+/)
    const pid = parts[0]
    const memVirtual2 = parseInt(parts[4], 10)
    const memReal2 = parseInt(parts[5], 10)
    const cpuPer2 = parseFloat(parts[8])
    const memPer2 = parseFloat(parts[9])
    const command2 = parts.splice(11).join(' ')
    // console.log(pid, command)

    if (!acc[pid]) {
      console.log('Unknown pid:', parts)
      return acc
    }
    Object.assign(acc[pid], {
      command2,
      memVirtual2,
      memReal2,
      cpuPer2,
      memPer2
    })

    return acc
  }, psStats)
}

function getPsStats (file) {
  return P.try(() => {
    if (file) {
      return Fs.readFileSync(Path.join(__dirname, file), 'utf8')
    } else {
      return runPs()
    }
  })
  .then(psText => {
    const ts = Date.now()
    const psLines = psText.trim().split(/[\n\r]+/)
    return psLines.reduce((acc, x) => {
      if (x.indexOf('USER ') === 0) {
        return acc
      }
      const parts = x.split(/[\s\t]+/)

      const pid = parts[1]
      const cpuPer = parseFloat(parts[2])
      const memPer = parseFloat(parts[3])
      const memVirtual = parseInt(parts[4], 10)
      const memReal = parseInt(parts[5], 10)
      const command = parts.splice(10).join(' ')

      // console.log(pid, command)
      acc[pid] = {
        ts,
        cpuPer,
        memPer,
        memVirtual,
        memReal,
        command
      }
      return acc
    }, { })
  })
}

function runPs () {
  return new Promise(resolve => {
    const getPs = 'ps auxwww'
    Exec(getPs, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`)
        return
      }
      // console.log(`stdout: ${stdout}`)
      // console.log(`stderr: ${stderr}`)
      resolve(stdout)
    })
  })
}

function runTop () {
  const getProcessesOSX = 'ps -auwww -o \'pid,command\''
  Exec(getProcessesOSX, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`)
      return
    }
    console.log(`stdout: ${stdout}`)
    console.log(`stderr: ${stderr}`)
  })
}
