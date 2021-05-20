import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { createObjectCsvWriter } from 'csv-writer';
import { join, resolve } from 'path';

config();

async function getClient(): Promise<AxiosInstance> {
    return axios.create({
        baseURL: `https://jira.devfactory.com/rest/api/2`,
        auth: {
            username: process.env.JIRA_USERNAME,
            password: process.env.JIRA_PASSWORD,
        },
    });
}

interface RawTicket {
    key: string;
    fields: {
        labels: string[];
        summary: string;
        created: string;
        customfield_10002: string;
        resolutiondate: string;
        customfield_28100: {
            displayName: string;
        };
        reporter: {
            displayName: string;
        };
        status: {
            name: string;
        };
        resolution: {
            name: string;
        };
        issuelinks: [{
            type: {
                name: string;
            };
            outwardIssue: {
                key: string;
            }
        }]
    };
}

export interface Ticket {
    epic?: string;
    key: string;
    summary: string;
    status: string;
    created: string;
    resolved?: string;
    svp?: string;
    reporter?: string;
}

export async function getTickets(jql: string): Promise<Ticket[]> {
    const client = await getClient();

    const PAGE_SIZE = 250;
    async function readJiraPage(startAt: number): Promise<RawTicket[]> {
        const response = await client.post('/search', {
            jql,
            fields: [
                'id',
                'reporter',
                'customfield_10002', // epic link
                'customfield_28100', // svp owner
                'summary',
                'created',
                'resolutiondate',
                'status',
                'issuelinks',
                'labels',
                'resolution'
            ],
            startAt,
            maxResults: PAGE_SIZE,
        });
        return response.data.issues;
    }

    async function readAllJiraTickets(): Promise<RawTicket[]> {
        const tickets: RawTicket[] = [];
        for (let i = 0; true; i += PAGE_SIZE) {
            const issues = await readJiraPage(i);
            if (issues?.length) {
                tickets.push(...issues);
            } else {
                break;
            }
        }
        return tickets;
    }

    return (await readAllJiraTickets())
        .map((t) => ({
            epic: t.fields.customfield_10002 || t.fields.issuelinks?.find(link => link.type.name === 'Relates' && link.outwardIssue?.key?.startsWith('CENPRO'))?.outwardIssue.key,
            key: t.key,
            status: t.fields.status.name === 'Done' ? t.fields.labels?.includes('ExecReject') || t.fields.resolution?.name !== 'Done' ? 'Rejected' : 'Done' : t.fields.status.name,
            summary: t.fields.summary,
            svp: t.fields.customfield_28100?.displayName,
            created: t.fields.created,
            resolved: t.fields.resolutiondate,
            reporter: t.fields.reporter?.displayName
        }));
}

interface GenericIssue {
    key: string;
    title: string;
    status: string;
    created: string;
    resolved?: string;
}

interface Story extends GenericIssue { }

interface Scr extends GenericIssue {
    reporter: string;
}

interface Epic extends GenericIssue {
    svp: string;
    stories: Story[];
    scrs: Scr[];
}

function toGenericIssue(ticket: Ticket): GenericIssue {
    return {
        key: ticket.key,
        created: ticket.created.substring(0, 10),
        status: ticket.status,
        title: ticket.summary,
        resolved: ticket.resolved?.substring(0, 10)
    };
}


async function main() {
    const TARGET_FOLDER = resolve(__dirname, 'output');
    const TIME_FRAME = 'startOfYear(-1)';

    const scrs = await getTickets(`
        project = CENPRO AND 
        type = "Spec Clarification Request" AND 
        created >= ${TIME_FRAME}
    `);

    const stories = await getTickets(`
        project = CENPRO AND 
        type = Story AND 
        status changed to "Done" AFTER ${TIME_FRAME} AND 
        "Spec Type" IN (Rebuild, Change, New)
    `);

    const epics = await getTickets(`
        project = CENPRO AND 
        type = Epic AND 
        status changed to "Done" AFTER ${TIME_FRAME} AND 
        "Spec Type" IN (Rebuild, Change, New)
    `);

    const consolidated: { [x: string]: Epic } = {};
    for (const epic of epics) {
        consolidated[epic.key] = {
            ...toGenericIssue(epic),
            svp: epic.svp,
            stories: [],
            scrs: []
        }
    }

    for (const story of stories) {
        if (consolidated[story.epic]) {
            consolidated[story.epic].stories.push({
                ...toGenericIssue(story),
            });
        }
    }

    for (const scr of scrs) {
        if (consolidated[scr.epic]) {
            consolidated[scr.epic].scrs.push({
                ...toGenericIssue(scr),
                reporter: scr.reporter
            });
        }
    }

    const flattened = Object.values(consolidated).flatMap(epic => epic.stories.map(story => ({ epic, type: 'Story', child: story })))
        .concat(Object.values(consolidated).flatMap(epic => epic.scrs.map(scr => ({ epic, type: 'SCR', child: scr }))));

    const writer = createObjectCsvWriter({
        header: [
            { id: 'epic.key', title: 'Epic Key' },
            { id: 'epic.title', title: 'Epic Title' },
            { id: 'epic.svp', title: 'SVP Owner' },
            { id: 'type', title: 'Type' },
            { id: 'child.key', title: 'Key' },
            { id: 'child.title', title: 'Title' },
            { id: 'child.reporter', title: 'Reporter' },
            { id: 'child.status', title: 'Status' },
            { id: 'child.created', title: 'Created' },
            { id: 'child.resolved', title: 'Resolved' },
        ],
        headerIdDelimiter: '.',
        path: join(TARGET_FOLDER, 'epics.csv')
    });
    await writer.writeRecords(flattened);
}

main();