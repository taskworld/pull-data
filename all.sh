#!/bin/bash

echo "Fetching Taskworld data .."
node fetch-tw-data.js --from 2016-06-01 --to 2020-06-01

echo "Fetching GA signups data .."
./get-adword-signups.sh 2016-06-01

echo "Fetching GA signups by device data .."
./get-adword-signups-device.sh 2016-06-01

echo "Fetching GA + AdWord stats .."
./get-adword-stats.sh 2016-06-01

echo "Preprocessing .."
node reports/combine-marketing-performance-data.js

echo "Creating customers report .."
npm run prod-customers

echo "Creating marketing performance report .."
node reports/create-marketing-performance-report.js upload
