'use strict'

const Sendgrid = require('./sendgrid')
const Path = require('path')

Sendgrid.sendEmail({
  from: 'reports@taskworld.com',
  to: 'anri@taskworld.com',
  subject: 'Test Report.',
  body: 'FYI... here’s the report.',
  files: [
    { path: Path.join(__dirname, 'testFile.txt'), mime: 'text/plain' }
  ],
  gzip: true
})
