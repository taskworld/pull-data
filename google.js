'use strict'

const Fs = require('fs')
const Moment = require('moment')
const Chalk = require('chalk')
const Google = require('googleapis')
const Csv = require('fast-csv')
const Analytics = Google.analyticsreporting('v4')

const oauth2Client = new Google.auth.OAuth2()

const Argv = require('minimist')(process.argv.slice(2))
run(Argv)

function getJwtClient () {
  const scopes = [
    'https://www.googleapis.com/auth/analytics.readonly'
  ]
  const credentials = require('../google-api-credentials.json')
  return new Google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    scopes,
    null
  )
}

function run (args) {
  const param = parseOpts(args)
  const query = queryGenerator(param)

  console.log(`
    Query Generated for:
    GA ID: ${Chalk.white(param.viewId)}
    From: ${Chalk.white(param.from)}
    To: ${Chalk.white(param.to)}
    With the following Query:
  `)
  console.log(JSON.stringify(query))
  getJwtClient().authorize((err, token) => {
    if (err) {
      return console.log(err)
    }
    oauth2Client.setCredentials(token)
    Analytics.reports.batchGet(query, handleGAResponse)
  })
}

function Usage(error) {
  if (error) {
    console.log(`
      ${Chalk.red.bold(error)}
    `)
  }

  console.log(`
  Usage: node <script> [options]

    --id            GA Account ID, e.g. ga:123456789 (${Chalk.red('required')})
    --from          Start exporting from <date>, format 'YYYY-MM-DD' (${Chalk.red('required')})
    --to            Stop exporting at <date>, format 'YYYY-MM-DD' (${Chalk.red('required')})
                    If not provided, defaults as of ${Chalk.white('<today>')}
    --dimensions    GA dimension fields (comma separated)
                    e.g. --dimensions ga:date,ga:country,ga:city (${Chalk.red('required')})
    --metrics       GA metric fields (comma separated)
                    e.g. --metrics ga:uniqueEvents,ga:totalEvents (${Chalk.red('required')})
    --sortby        GA dimension fields (comma separated)
                    e.g. ga:date,ga:country (optional)
        ${Chalk.white('--order')}     ASC | DESC (comma separated) (required if --sortby is provided)
                    e.g. --sortby ga:date,ga:country --order ASC,DESC
                    e.g. --sortby ga:date,ga:country --order DESC
  `)

  process.exit()
}


function parseOpts(opts) {
  let id = opts['id'] || Usage('--id is required')
  let from = opts['from'] || Usage('--from is required')
  let to = opts['to'] || Moment().format('YYYY-MM-DD')
  let dimensions = opts['dimensions'] || Usage('--dimensions is required')
  let metrics = opts['metrics'] || Usage('--metrics is required')
  let sortby = opts['sortby'] ? opts['sortby'] : false
  let order = (opts['sortby'] && opts['order']) ? opts['order'] : 'ASC'

  if (sortby && !order) {
    for (let i = 0; i < sortby.split(',').length; ++i) {
      order += ',' + order
    }
  }

  if (!sortby) {
    order = null
  }

  dimensions = dimensions
  .split(',')
  .map(x => ({
    'name': x
  }))

  metrics = metrics
  .split(',')
  .map(x => ({
    'expression': x
  }))

  if (sortby) {
    sortby = sortby
    .split(',')
    .map((x, i) => ({
      'fieldName': x,
      'sortOrder': order.split(',')[i].replace('ASC', 'ASCENDING').replace('DESC', 'DESCENDING')
    }))
  }

  const param = {
    viewId: id,
    from: from,
    to: to,
    dimensions: dimensions,
    metrics: metrics,
    sortby: sortby
  }

  return param
}


function queryGenerator(param) {
  const query = {
    'headers': { 'Content-Type': 'application/json' },
    'auth': oauth2Client,
    'resource': {
      'reportRequests': [
        {
          'viewId': param.viewId,
          'dateRanges': [
            {
              'startDate': param.from,
              'endDate': param.to
            }
          ],
          'dimensions': param.dimensions,
          'metrics': param.metrics,
          'orderBys': param.sortby,
          'pageSize': 10000,
          'includeEmptyRows': true,
          'hideTotals': false,
          'hideValueRanges': false
        }
      ]
    }
  }

  return query
}

function handleGAResponse (err, data) {
  if (err) {
    throw err
  }
  console.log('Converting the Google report ..')
  const rows = convertGoogleReport(data)
  console.log('rows=', rows)
}

function convertGoogleReport (json) {
  const dimensionHeaders = json.reports[0].columnHeader.dimensions
  const metricHeaders = json.reports[0].columnHeader.metricHeader.metricHeaderEntries.map((x) => x.name)

  return json.reports[0].data.rows.map((x) => {
    let obj1 = dimensionHeaders.reduce((d, dh, i) => {
      d[dh] = x.dimensions[i]
      return d
    }, { })

    return metricHeaders.reduce((m, mh, i) => {
      m[mh] = x.metrics[0].values[i]
      return m
    }, obj1)
  })
}
