#!/bin/bash

node google.js \
 --id ga:104623764 \
 --from $1 \
 --dimensions ga:date,ga:eventAction,ga:eventLabel,ga:country \
 --metrics ga:totalEvents \
 --sortby ga:date,ga:eventAction \
 --order DESC,ASC \
 --filter ga:eventAction,IN_LIST,page:project:kanban:create-task,page:projects:click:open:noti-center \
 --name ga-events
