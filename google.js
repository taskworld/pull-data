'use strict'

const Moment = require('moment')
const Chalk = require('chalk')
const Google = require('googleapis')
const Analytics = Google.analyticsreporting('v4')

const PAGE_SIZE = 5000

const oauth2Client = new Google.auth.OAuth2()

const Util = require('./util')
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

function hasNextPage (data, query) {
  const pageToken = data.reports[0].nextPageToken
  if (!pageToken) {
    return false
  }
  query.resource.reportRequests[0].pageToken = pageToken
  console.log(`Set page token to ${query.resource.reportRequests[0].pageToken}`)
  return true
}

function getDataFetcher (query, params) {
  let rows = []
  const reportFileName = `/tmp/${params.reportName}.csv`
  console.log(`Creating report ${reportFileName}`)

  const batchGet = () => {
    Analytics.reports.batchGet(query, (err, data) => {
      if (err) {
        return console.error(err)
      }
      if (!data.reports[0].data.rows) {
        return console.log('No results!')
      }

      const numRows = data.reports[0].data.rows.length
      if (numRows) {
        console.log(`Fetched ${numRows} rows from GA.`)
        rows = rows.concat(convertGoogleReport(data))

        // Continue if there’s a next page.
        if (hasNextPage(data, query)) {
          batchGet()
        // Otherwise we’re done.
        } else if (rows.length) {
          console.log(`Writing ${rows.length} rows to ${reportFileName}.`)

          Util.writeCsv(rows, reportFileName)
          .then(() => console.log('It’s a Done Deal.'))
        }
      }
    })
  }
  return batchGet
}

function run (args) {
  const params = parseOpts(args)
  const query = queryGenerator(params)

  console.log(`
    Generated Query:

    GA ID: ${Chalk.white(params.viewId)}
    From:  ${Chalk.white(params.from)}
    To:    ${Chalk.white(params.to)}
    Query: ${JSON.stringify(query, false, 2)}
  `)

  getJwtClient().authorize((err, token) => {
    if (err) {
      return console.log(err)
    }
    oauth2Client.setCredentials(token)
    // Fetch data until we’re done.
    getDataFetcher(query, params)()
  })
}

function Usage (error) {
  if (error) {
    console.log(`
      ${Chalk.red.bold(error)}
    `)
  }

  console.log(`
  Usage: node <script> [options]

    --id            GA Account ID, e.g. ga:123456789 (${Chalk.red('required')}).

    --from          Start exporting from <date>, format 'YYYY-MM-DD' (${Chalk.red('required')}).

    --to            Stop exporting at <date>, format 'YYYY-MM-DD' (${Chalk.red('required')}).
                    If not provided, defaults as of ${Chalk.white('<today>')}

    --dimensions    GA dimension fields (comma separated).
                    e.g. --dimensions ga:date,ga:country,ga:city (${Chalk.red('required')})

    --metrics       GA metric fields (comma separated).
                    e.g. --metrics ga:uniqueEvents,ga:totalEvents (${Chalk.red('required')})

    --sortby        GA dimension fields (comma separated).
                    e.g. ga:date,ga:country (optional)
        ${Chalk.white('--order')}     ASC | DESC (comma separated) (required if --sortby is provided)
                    e.g. --sortby ga:date,ga:country --order ASC,DESC
                    e.g. --sortby ga:date,ga:country --order DESC

    --name          Name of the report.
  `)

  process.exit()
}

function parseOpts (opts) {
  let id = opts['id'] || Usage('--id is required')
  let from = opts['from'] || Usage('--from is required')
  let to = opts['to'] || Moment().format('YYYY-MM-DD')
  let dimensions = opts['dimensions'] || Usage('--dimensions is required')
  let metrics = opts['metrics'] || Usage('--metrics is required')
  let sortby = opts['sortby'] ? opts['sortby'] : false
  let order = (opts['sortby'] && opts['order']) ? opts['order'] : 'ASC'
  let filter = opts['filter']
  let reportName = opts['name'] || `report-${opts['from']}`

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
  .map((x) => ({ name: x }))

  metrics = metrics
  .split(',')
  .map((x) => ({ expression: x }))

  if (sortby) {
    sortby = sortby
    .split(',')
    .map((x, i) => ({
      'fieldName': x,
      'sortOrder': order.split(',')[i].replace('ASC', 'ASCENDING').replace('DESC', 'DESCENDING')
    }))
  }

  const params = {
    viewId: id,
    from: from,
    to: to,
    dimensions: dimensions,
    metrics: metrics,
    sortby: sortby,
    reportName
  }

  if (filter) {
    const filterParts = filter.split(',')
    params.filters = [{
      name: filterParts[0],
      operator: filterParts[1],
      expression: filterParts[2]
    }]
  }

  return params
}

function queryGenerator (params) {
  const query = {
    'headers': { 'Content-Type': 'application/json' },
    'auth': oauth2Client,
    'resource': {
      'reportRequests': [
        {
          'viewId': params.viewId,
          'dateRanges': [
            {
              'startDate': params.from,
              'endDate': params.to
            }
          ],
          'dimensions': params.dimensions,
          'metrics': params.metrics,
          'orderBys': params.sortby,
          'pageSize': PAGE_SIZE,
          'pageToken': params.pageToken,
          'includeEmptyRows': false,
          'hideTotals': true,
          'hideValueRanges': true
        }
      ]
    }
  }

  if (params.filters) {
    query.resource.reportRequests[0].dimensionFilterClauses = [{
      operator: 'AND',
      filters: params.filters.map((x) => createFilterClause(x))
    }]
  }

  return query
}

function createFilterClause (opts) {
  return {
    dimensionName: opts.name,
    not: false,
    operator: opts.operator.toUpperCase(),
    expressions: [opts.expression],
    caseSensitive: true
  }
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
