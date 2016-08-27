'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Csv = require('fast-csv')

function writeCsv (rows, file) {
  return new P((resolve) => {
    const stream = Fs.createWriteStream(file)
    Csv
    .write(rows, { headers: true })
    .on('error', (err) => console.error(err))
    .on('finish', resolve)
    .pipe(stream)
  })
}

function readCsv (file) {
  return new P((resolve, reject) => {
    const stream = Fs.createReadStream(file)
    const rows = []
    const csvStream = Csv({
      objectMode: true,
      headers: true
    })
    .on('error', (err) => {
      console.error(err)
      reject(err)
    })
    .on('data', (obj) => {
      rows.push(obj)
    })
    .on('end', () => resolve(rows))

    stream.pipe(csvStream)
  })
}

module.exports = {
  writeCsv,
  readCsv
}
