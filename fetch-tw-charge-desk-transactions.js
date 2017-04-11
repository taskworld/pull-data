'use strict'

const Assert = require('assert')
Assert(process.env.PULLDATA_CHARGE_DESK_SECRET, 'Missing env PULLDATA_CHARGE_DESK_SECRET')

const P = require('bluebird')
const Exec = require('child_process').exec
const Fs = require('fs')
const Moment = require('moment')

const Util = require('./util')
const S3 = require('./lib/s3')

P.promisifyAll(Fs)

const REPORT_FILE_NAME = '/tmp/tw-charge-desk-transactions.csv'
const DAY_STATS_FILE_NAME = '/tmp/tw-charge-desk-day-stats.csv'
const MONTH_STATS_FILE_NAME = '/tmp/tw-charge-desk-month-stats.csv'
const MAX_DOCS = 500

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
    const country = x.customer_country || 'N/A'

    if (!acc.day[day]) {
      acc.day[day] = {
        total: 0,
        refunded: 0,
        canceled: 0,
        country: { }
      }
    }

    if (!acc.month[month]) {
      acc.month[month] = {
        total: 0,
        refunded: 0,
        canceled: 0,
        country: { }
      }
    }

    if (paidStatus[x.status]) {
      // console.log(`status: ${x.status}, amount: ${x.amount_formatted}`)
      acc.day[day].total += amount
      acc.month[month].total += amount

      if (!acc.day[day].country[country]) acc.day[day].country[country] = 0
      acc.day[day].country[country] += amount

      if (!acc.month[month].country[country]) acc.month[month].country[country] = 0
      acc.month[month].country[country] += amount
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
      const dateByCountryStats = Object.keys(dateStats.country).map(x => [x, dateStats.country[x]])
      dateByCountryStats.sort((a, b) => a[1] < b[1] ? 1 : -1)
      const countryString = dateByCountryStats.map(x => `${x[0]}: ${x[1].toLocaleString()}`).join(', ')
      rows.push({
        date,
        total: dateStats.total.toLocaleString(),
        refunded: dateStats.refunded.toLocaleString(),
        canceled: dateStats.canceled.toLocaleString(),
        countryString
      })
    })
    return rows
  }

  const statsReports = [
    { name: 'day', filename: DAY_STATS_FILE_NAME },
    { name: 'month', filename: MONTH_STATS_FILE_NAME }
  ]

  for (const r of statsReports) {
    const rows = getReport(r.name)
    yield Util.writeCsv(rows, r.filename)
    if (args.upload) {
      const res = yield S3.uploadToS3(S3.createItem(r.filename))
      const expiresMatch = /Expires=(\d+)/.exec(res.signedUrl)
      const expiresDate = new Date(parseInt(expiresMatch[1], 10) * 1000)
      console.log(`Signed URL (expires: ${expiresDate}):\n${res.signedUrl}\n`)
    }
  }

  console.log('It’s a Done Deal.')
}

function * fetch (opts) {
  console.log('Fetching ChargeDesk transactions ..')

  const REPORT_FILE_NAME = `/tmp/tw-charge-desk-transactions.csv`

  let offset = 0
  let max = MAX_DOCS

  let report = []
  let lastInvoice = null

  if (hasFile(REPORT_FILE_NAME)) {
    report = yield Util.readCsv(REPORT_FILE_NAME)
    lastInvoice = report[0].invoice_url
    max = 50 // Fetch 50 at a time if we’re updating an existing report!
    console.log(`Updating existing report with ${report.length} rows !`)
  }

  while (true) {
    let txns = yield * getChargeDeskTransactions(offset, max)
    if (!txns.length) break

    console.log(`Fetched ${txns.length} transactions (total: ${offset}) from charge desk ..`)

    if (lastInvoice) {
      const foundExistingInvoiceAt = txns.findIndex(x => x.invoice_url === lastInvoice)
      if (foundExistingInvoiceAt !== -1) {
        const newRows = txns.slice(0, foundExistingInvoiceAt)
        if (!newRows.length) {
          console.log('No new rows found, exiting ..')
          return false
        }
        report = report.concat(newRows)
        console.log(`Found an existing row at index ${foundExistingInvoiceAt}, we’re done !`)
        break
      }
    }

    offset += txns.length
    report = report.concat(txns)
  }

  // Unique and sort on occurred field.
  const reportUnique = { }
  report.forEach(x => {
    reportUnique[x.invoice_url] = x
  })
  report = Object.keys(reportUnique).map(x => reportUnique[x])
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
  return toTransactionRows(JSON.parse(result))
}

function toTransactionRows (data) {
  // DUMP !
  // data.data.forEach(x => {
  //   if (!x.product_id) console.log(JSON.stringify(x, null, 2))
  // })

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
      payment_method_brand: x.payment_method_brand,
      payment_method_bank: x.payment_method_bank,
      payment_method_describe: x.payment_method_describe,
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
