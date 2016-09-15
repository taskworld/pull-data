#!/bin/bash

echo "Fetching Taskworld data .."
node fetch-tw-data.js --from 2016-06-01 --to 2017-06-01

echo "Fetching GA signups data .."
./get-adword-signups.sh 2016-06-01

echo "Fetching GA + AdWord stats .."
./get-adword-stats.sh 2016-06-01

echo "Preprocessing .."
node reports/combine-marketing-performance-data.js

echo "Creating customers report .."
node reports/create-customers-report.js upload

echo "Creating marketing performance report .."
node reports/create-marketing-performance-report.js upload
