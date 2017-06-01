#!/bin/bash

echo "Fetching Taskworld data .."
node fetch-tw-data.js --from 2016-06-01 --to 2018-06-01

echo "Fetching GA signups data .."
./get-adword-signups.sh 2016-06-01

echo "Fetching GA signups by device data .."
./get-adword-signups-device.sh 2016-06-01

echo "Creating customers report .."
node reports/create-customers-report.js
