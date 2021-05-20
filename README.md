## P2 stats generator

To run this script:
 - Make sure to have NodeJS installed (version >=10).
 - Run `npm install` in this folder.
 - Create an `output` subfolder in this folder.
 - Create an `.env` file with your `JIRA_USERNAME` and `JIRA_PASSWORD`.
 - Run `npm start`.
 - An `epics.csv` file will be created in the `output` folder.

The duration for which to generate the stats can be changed by adjusting the `TIME_FRAME` constants from `index.ts`.