#!/bin/bash

node fetch-tw-data.js --from 2016-06-01 --to 2017-06-01
./get-adword-signups.sh 2016-06-01
./get-adword-stats.sh 2016-06-01
node reports/get-ad-group-performance-data.js
