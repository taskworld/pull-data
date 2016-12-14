'use strict'

const AWS = require('aws-sdk')
const P = require('bluebird')
const Zlib = require('zlib')
const Fs = require('fs')
const Path = require('path')
const Assert = require('assert')
const T = require('tcomb')
const Mimer = require('mimer')

Assert(process.env.PULLDATA_AWS_BUCKET, 'Missing env `PULLDATA_AWS_BUCKET`')
Assert(process.env.PULLDATA_AWS_REGION, 'Missing env `PULLDATA_AWS_REGION`')
Assert(process.env.PULLDATA_AWS_KEY, 'Missing env `PULLDATA_AWS_KEY`')
Assert(process.env.PULLDATA_AWS_SECRET, 'Missing env `PULLDATA_AWS_SECRET`')

AWS.config.region = process.env.PULLDATA_AWS_REGION

const S3 = new AWS.S3({
  accessKeyId: process.env.PULLDATA_AWS_KEY,
  secretAccessKey: process.env.PULLDATA_AWS_SECRET
})
P.promisifyAll(S3)

function uploadToS3 (item) {
  return P.try(() => {
    T.String(item.bucket)
    T.String(item.key)
    T.String(item.path)
    const gzip = Zlib.createGzip({ level: 9 })
    const params = {
      Bucket: item.bucket,
      Key: item.key,
      Body: Fs.createReadStream(item.path).pipe(gzip),
      StorageClass: 'REDUCED_REDUNDANCY',
      ACL: 'private',
      ContentEncoding: 'gzip',
      ContentType: Mimer(item.key)
    }
    console.log(`Uploading -> ${params.Bucket}:${params.Key}`)
    return S3.uploadAsync(params)
    .then(res => {
      res.signedUrl = S3.getSignedUrl('getObject', {
        Bucket: params.Bucket,
        Key: params.Key,
        Expires: 60 * 60 * 24 * 30 // 30 days.
      })
      return res
    })
  })
}

function createItem (file, prefix) {
  const p = prefix || 'reports-1955'
  return {
    bucket: process.env.PULLDATA_AWS_BUCKET,
    key: `${p}/${Path.basename(file)}`,
    path: file
  }
}

module.exports = {
  createItem,
  uploadToS3
}
