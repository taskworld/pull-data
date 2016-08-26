'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Csv = require('fast-csv')

function writeCsv (rows, file) {
  return new P((resolve) => {
    const stream = Fs.createWriteStream(file)
    Csv
    .write(rows, { headers: true })
    .on('finish', resolve)
    .pipe(stream)
  })
}

module.exports = {
  writeCsv
}
