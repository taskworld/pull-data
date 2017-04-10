'use strict'

const Assert = require('assert')
Assert(process.env.PULLDATA_CHARGE_DESK_SECRET, 'Missing env PULLDATA_CHARGE_DESK_SECRET')

const Moment = require('moment')
const P = require('bluebird')
const Exec = require('child_process').exec
const Fs = require('fs')
const Util = require('./util')
P.promisifyAll(Fs)

const MAX_DOCS = 500

P.coroutine(run)(require('minimist')(process.argv.slice(2)))

function * run (args) {
  console.log('Pulling transactions ..')
  let report = []
  let offset = 0

  while (true) {
    const txns = yield * getChargeDeskTransactions(offset)
    // console.log(JSON.stringify(txns, null, 2))
    if (!txns.length) break
    console.log(`Fetched ${txns.length} transactions (total: ${offset}) from charge desk ..`)
    offset += txns.length
    report = report.concat(txns)
  }

  const reportFileName = `/tmp/tw-charge-desk-transactions.csv`
  yield Util.writeCsv(report, reportFileName)
}

function * getChargeDeskTransactions (offset = 0) {
  const command = `curl -u ${process.env.PULLDATA_CHARGE_DESK_SECRET}: 'https://api.chargedesk.com/v1/charges?count=${MAX_DOCS}&offset=${offset}'`
  const result = yield exec(command)
  return toTransactionRows(JSON.parse(result))
}

function toTransactionRows (data) {
  return data.data.map(x => {
    return {
      occurred: Moment.unix(x.occurred).format(),
      occurred_relative: x.occurred_relative,
      customer_email: x.customer_email,
      customer_name: x.customer_name,
      customer_country: x.customer_country,
      gateway_id: x.gateway_id,
      amount: parseFloat(x.amount),
      amount_refunded: parseFloat(x.amount_refunded),
      amount_formatted: x.amount_formatted,
      status: x.status,
      currency: x.currency,
      payment_method_brand: x.paypal,
      payment_method_bank: x.payment_method_bank,
      payment_method_describe: x.payment_method_describe,
      invoice_url: x.invoice_url,
      customer_id: x.customer_id
    }
  })
}

function exec (cmd) {
  const options = {
    maxBuffer: 1024 * 1024 * 10
  }
  console.log('Command:', cmd)
  return new P((resolve, reject) => {
    Exec(cmd, options, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`)
        return reject(error)
      }
      resolve(stdout)
    })
  })
}
