'use strict'

const Assert = require('assert')
Assert(process.env.PULLDATA_CHARGE_DESK_SECRET, 'Missing env PULLDATA_CHARGE_DESK_SECRET')

const P = require('bluebird')
const Exec = require('child_process').exec
const Path = require('path')
const Fs = require('fs')
const Moment = require('moment')

const Util = require('./util')
const S3 = require('./lib/s3')

P.promisifyAll(Fs)

const REPORT_FILE_NAME = '/tmp/tw-charge-desk-transactions.csv'
const DAY_STATS_FILE_NAME = '/tmp/tw-charge-desk-day-stats.csv'
const MONTH_STATS_FILE_NAME = '/tmp/tw-charge-desk-month-stats.csv'
const HTML_REPORT_FILE_NAME = '/tmp/tw-charge-desk-transactions.html'
const MAX_DOCS = 500
const MAX_ROWS = 1500

P.coroutine(run)(require('minimist')(process.argv.slice(2)))

function * run (opts) {
  // Rock on.

  if (opts.fetch) {
    return yield * fetch(opts)
  }

  if (opts.report) {
    return yield * createReport(opts)
  }

  if (opts.all) {
    if (yield * fetch(opts)) {
      yield * createReport(opts)
    }
    return
  }

  console.log(`
    node fetch-tw-charge-desk-transactions.js

      --fetch     Fetch / Update transactions from ChargeDesk.
      --report    Create a report based on ChargeDesk transaction history.
      --all       Both fetch and create a new report.
  `)
}

function * createReport (args) {
  console.log('Creating report ..')

  if (!hasFile(REPORT_FILE_NAME)) {
    console.log('No report file found, run the script with --fetch argument first !')
  }

  const report = yield Util.readCsv(REPORT_FILE_NAME)

  const refundedStatus = {
    'refunded': 1,
    'partially refunded': 1
  }

  const paidStatus = {
    'paid': 1,
    'invoiced': 1,
    'pending': 1
  }

  const canceledStatus = {
    'invoice canceled': 1
  }

  const stats = report.reduce((acc, x) => {
    const amount = parseInt(x.amount, 10)
    const day = Moment(x.occurred).utcOffset('+07:00').format('YYYY-MM-DD')
    const month = Moment(x.occurred).utcOffset('+07:00').format('YYYY-MM')

    if (!acc.day[day]) {
      acc.day[day] = {
        total: 0,
        refunded: 0,
        canceled: 0
      }
    }

    if (!acc.month[month]) {
      acc.month[month] = {
        total: 0,
        refunded: 0,
        canceled: 0
      }
    }

    if (paidStatus[x.status]) {
      // console.log(`status: ${x.status}, amount: ${x.amount_formatted}`)
      acc.day[day].total += amount
      acc.month[month].total += amount
    }

    if (refundedStatus[x.status]) {
      // console.log(`status: ${x.status}, amount: ${x.amount_formatted}`)
      acc.day[day].refunded += amount
      acc.month[month].refunded += amount
    }

    if (canceledStatus[x.status]) {
      // console.log(`status: ${x.status}, amount: ${x.amount_formatted}`)
      acc.day[day].canceled += amount
      acc.month[month].canceled += amount
    }

    return acc
  }, {
    day: { },
    month: { }
  })

  const getReport = (field) => {
    const rows = []
    const dates = Object.keys(stats[field])
    dates.sort((a, b) => a < b ? 1 : -1)
    dates.forEach(date => {
      const dateStats = stats[field][date]
      rows.push({
        date,
        total: dateStats.total.toLocaleString(),
        refunded: dateStats.refunded.toLocaleString(),
        canceled: dateStats.canceled.toLocaleString()
      })
    })
    return rows
  }

  const statsReports = [
    { name: 'day', filename: DAY_STATS_FILE_NAME },
    { name: 'month', filename: MONTH_STATS_FILE_NAME }
  ]

  // Create CSV reports.
  if (args.csv) {
    for (const r of statsReports) {
      const rows = getReport(r.name)
      yield Util.writeCsv(rows, r.filename)

      if (args.upload) yield * upload(r.filename)
    }
  }

  // Create HTML report.
  if (args.html) {
    const data = {
      transactions: report
    }

    for (const r of statsReports) {
      data[r.name] = getReport(r.name)
    }

    const layout = Path.join(__dirname, 'reports', 'layout.html')
    const template = Path.join(__dirname, 'reports', 'charge-desk-transactions-report-react.js')

    let html = Fs.readFileSync(layout, 'utf8')
    html = html
    .replace('{{DATA}}', JSON.stringify(data, null, 2))
    .replace('{{SCRIPT}}', Fs.readFileSync(template, 'utf8'))
    Fs.writeFileSync(HTML_REPORT_FILE_NAME, html)

    if (args.upload) yield * upload(HTML_REPORT_FILE_NAME)
  }

  console.log('It’s a Done Deal.')
}

function * upload (filename) {
  const res = yield S3.uploadToS3(S3.createItem(filename))
  const expiresMatch = /Expires=(\d+)/.exec(res.signedUrl)
  const expiresDate = new Date(parseInt(expiresMatch[1], 10) * 1000)
  console.log(`Signed URL (expires: ${expiresDate}):\n${res.signedUrl}\n`)
}

function * fetch (opts) {
  console.log('Fetching ChargeDesk transactions ..')

  const REPORT_FILE_NAME = `/tmp/tw-charge-desk-transactions.csv`

  let offset = 0
  let max = MAX_DOCS
  let report = []

  while (true) {
    let txns = yield * getChargeDeskTransactions(offset, max)
    if (!txns.length) break

    console.log(`Fetched ${txns.length} transactions (total: ${offset}) from charge desk ..`)

    offset += txns.length
    report = report.concat(txns)

    if (report.length > MAX_ROWS) {
      report = report.slice(0, MAX_ROWS)
      break
    }
  }

  // Sort on occurred field.
  report.sort((a, b) => a.occurred < b.occurred ? 1 : -1)

  yield Util.writeCsv(report, REPORT_FILE_NAME)
  return true
}

function hasFile (file) {
  try {
    Fs.accessSync(file)
    return true
  } catch (err) {
    return false
  }
}

function * getChargeDeskTransactions (offset, max) {
  const command = `curl -u ${process.env.PULLDATA_CHARGE_DESK_SECRET}: 'https://api.chargedesk.com/v1/charges?count=${max}&offset=${offset}'`
  const result = yield exec(command)
  return toTransactionRows(JSON.parse(result), offset)
}

function toTransactionRows (data, offset) {
  // Dump first row.
  if (offset === 0 && data && data.data) {
    console.log(JSON.stringify(data.data[0], null, 2))
  }

  return data.data.map(x => {
    return {
      occurred: Moment.unix(x.occurred).utc().format(),
      occurred_relative: x.occurred_relative,
      product_id: x.product_id,
      amount: parseFloat(x.amount),
      amount_refunded: parseFloat(x.amount_refunded),
      amount_formatted: x.amount_formatted,
      status: x.status,
      customer_email: x.customer_email,
      customer_name: x.customer_name,
      customer_country: x.customer_country,
      customer_id: x.customer_id,
      currency: x.currency,
      gateway_id: x.gateway_id,
      payment_method: x.payment_method,
      payment_method_brand: x.payment_method_brand,
      payment_method_bank: x.payment_method_bank,
      payment_method_describe: x.payment_method_describe,
      charge_id: x.charge_id,
      invoice_url: x.invoice_url
    }
  })
}

function exec (cmd) {
  const options = {
    maxBuffer: 1024 * 1024 * 10
  }
  // console.log('Command:', cmd)
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
