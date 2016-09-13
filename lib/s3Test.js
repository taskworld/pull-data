'use strict'

const S3 = require('./s3')
const Fs = require('fs')

const file = '/tmp/testfileabc.html'

Fs.writeFileSync(file, '<html><body><h1>Hello!</h1></body></html>')

S3.uploadToS3(S3.createItem('/tmp/testfileabc.html'))
.then(res => console.log('res=', res))
