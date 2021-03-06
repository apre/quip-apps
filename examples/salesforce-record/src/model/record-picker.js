// Copyright 2017 Quip

import {ResponseHandler} from "../../../shared/base-field-builder/response-handler.js";
import {
    SalesforceRecordEntity,
    RECORD_PREFIX_TYPE,
} from "./salesforce-record.js";
import {RECORD_TYPE_DISPLAYNAMES} from "../record-picker.jsx";
import {SalesforceClient} from "../client.js";

export const SUPPORTED_RECORD_TYPES = [
    "Account",
    "Opportunity",
    //"Case",
    "Contact",
    "Lead",
];

export const SUPPORTED_LISTVIEWS = {
    "Account": [
        "RecentlyViewed",
        "RecentlyViewedAccounts",
        "MyAccounts",
        "NewThisWeek",
        "AllAccounts",
    ],
    "Contact": [
        "RecentlyViewed",
        "RecentlyViewedContacts",
        "MyContacts",
        "NewThisWeek",
        "BirthdaysThisMonth",
        "AllContacts",
    ],
    //"Case": ["RecentlyViewedCases"],
    "Lead": [
        "RecentlyViewed",
        "RecentlyViewedLeads",
        "MyUnreadLeads",
        "TodaysLeads",
        "AllOpenLeads",
    ],
    "Opportunity": [
        "RecentlyViewed",
        "RecentlyViewedOpportunities",
        "ClosingNextMonth",
        "ClosingThisMonth",
        "MyOpportunities",
        "NewThisWeek",
        "Default_Opportunity_Pipeline",
        "Won",
        "AllOpportunities",
    ],
};

export class RecordPickerEntity extends quip.apps.RootRecord {
    static ID = "recordPicker";

    static getProperties() {
        return {
            lastFetchedTime: "number",
            recordTypes: "object",
            selectedRecord: SalesforceRecordEntity,
            useSandbox: "boolean",
            instanceUrl: "string",
        };
    }

    static getDefaultProperties() {
        let defaultRecordTypes = {};
        for (let recordType of SUPPORTED_RECORD_TYPES) {
            defaultRecordTypes[recordType] = {
                relatedLists: [],
                schema: {},
            };
        }
        return {recordTypes: defaultRecordTypes, useSandbox: false};
    }

    initialize() {
        this.pickerData = {};
        SUPPORTED_RECORD_TYPES.map(type => {
            this.pickerData[type] = {
                listViewsData: {},
                schema: {},
            };
        });
    }

    setClient(client) {
        this.salesforceClient_ = client;
    }

    getClient() {
        return this.salesforceClient_;
    }

    toggleUseSandbox() {
        const useSandbox = !this.useSandbox();
        this.setUseSandbox(useSandbox);
        let auth;
        if (useSandbox) {
            auth = quip.apps.auth("salesforce-test");
        } else {
            auth = quip.apps.auth("salesforce");
        }
        const salesforceClient = new SalesforceClient(auth);
        this.setClient(salesforceClient);
    }

    login(onAuthenticated) {
        this.getClient().login(onAuthenticated);
    }

    logout(callback) {
        this.getClient().logout(callback);
    }

    fetchData() {
        let recordFetcher;
        let shouldOverWriteSchema = false;
        const selectedRecord = this.getSelectedRecord();
        if (selectedRecord && !selectedRecord.isPlaceholder()) {
            recordFetcher = selectedRecord.fetchData(selectedRecord);

            const ownerId = selectedRecord.getOwnerId();
            const viewerId =
                quip.apps.getViewingUser() !== null
                    ? quip.apps.getViewingUser().getId()
                    : null;

            if (ownerId !== null && ownerId === viewerId) {
                shouldOverWriteSchema = true;
            }
        }
        const recordTypes = Object.keys(this.getRecordTypes());
        const schemaFetchers = recordTypes.map(recordType =>
            this.fetchRecordSchemaForType_(recordType)
        );

        const listViewFetchers = recordTypes.map(recordType =>
            this.fetchListViewsForType_(recordType)
        );

        //const relatedListsFetchers = recordTypes.map(recordType =>
        //    this.fetchRelatedListsForType_(recordType)
        //);

        const fetchers = [
            ...schemaFetchers,
            ...listViewFetchers,
            //...relatedListsFetchers,
        ];

        if (recordFetcher) {
            fetchers.push(recordFetcher);
        }
        return Promise.all(fetchers).then(() => {
            if (!shouldOverWriteSchema) {
                return;
            }
            const instanceUrl = this.getInstanceUrl();
            if (this.getClient().getInstanceUrl() !== instanceUrl) {
                this.setInstanceUrl(this.getClient().getInstanceUrl());
            }
            const recordTypes = this.getRecordTypes();
            const ownerId = quip.apps.getViewingUser().getId();
            for (let recordType of SUPPORTED_RECORD_TYPES) {
                recordTypes[recordType].schema = this.pickerData[
                    recordType
                ].schema;
                recordTypes[recordType].ownerId = ownerId;
            }
            this.setRecordTypes(recordTypes);
        });
    }

    fetchRecordSchemaForType_(recordType) {
        const recordData = this.pickerData[recordType];
        if (this.isRecent(recordData.schema)) {
            return new Promise(function(resolve, reject) {
                resolve(recordData.schema);
            });
        } else {
            return this.getClient()
                .fetchObjectInfo(recordType)
                .then(ResponseHandler.parseSchema)
                .then(response => {
                    recordData.schema = response;
                    recordData.schema.lastFetchedTime = Date.now();
                    return recordData.schema;
                });
        }
    }

    fetchListViewsForType_(recordType) {
        const listViewsData = {};
        const allListViewLabel = "All " + RECORD_TYPE_DISPLAYNAMES[recordType];
        const recentListViewLabel =
            "Recently Viewed " + RECORD_TYPE_DISPLAYNAMES[recordType];

        listViewsData["RecentlyViewed"] = {
            label: "Recently Viewed",
            key: "RecentlyViewed",
            describeUrl: null,
            query:
                `SELECT Name, Id, LastModifiedDate FROM ${recordType}` +
                ` WHERE LastViewedDate != NULL ORDER BY LastViewedDate DESC`,
            id: "RecentlyViewed",
        };

        return this.getClient()
            .fetchListViews(recordType, "recent")
            .then(response => {
                return ResponseHandler.parseListViews(response, recordType);
            })
            .then(listViews => {
                listViews.map(listView => {
                    if (listView.label != allListViewLabel &&
                        listView.label != recentListViewLabel) {
                        //FIXME: temp dedup
                        listViewsData[listView.key] = listView;
                    }
                });
                listViewsData["All"] = {
                    label: allListViewLabel,
                    key: "All",
                    describeUrl: null,
                    query: `SELECT Name, Id, LastModifiedDate FROM ${recordType}`,
                    id: "All",
                };
                this.pickerData[recordType].listViewsData = listViewsData;
                return listViewsData;
            });
    }

    fetchRelatedListsForType_(recordType) {
        return this.getClient()
            .fetchRelatedLists(recordType)
            .then(ResponseHandler.parseRelatedLists)
            .then(relatedLists => {
                const recordTypes = this.getRecordTypes();
                recordTypes[recordType].relatedLists = relatedLists;
                this.setRecordTypes(recordTypes);
                return relatedLists;
            });
    }

    fetchRecordsDataByQuery_(query, searchTerm = null) {
        if (searchTerm) {
            query = this.reformatQuery_(query, searchTerm);
        }
        // FIXME
        query = query + " LIMIT 200";
        return this.getClient()
            .fetchSoqlQuery(query)
            .then(ResponseHandler.parseSoqlRecords);
    }

    //TODO: move to util.js
    reformatQuery_(query, searchTerm) {
        if (!query) return;
        query = query.toLowerCase();

        if (query.includes("order by")) {
            const seg = query.split("order by");
            if (seg[0].includes("where")) {
                seg[0] += ` AND Name LIKE \'${searchTerm}%\' `;
            } else {
                seg[0] += ` Where Name LIKE \'${searchTerm}%\' `;
            }
            return seg[0] + "order by" + seg[1];
        } else {
            if (query.includes("where")) {
                query += ` AND Name LIKE \'${searchTerm}%\' `;
            } else {
                query += ` Where Name LIKE \'${searchTerm}%\' `;
            }
            return query;
        }
    }

    fetchRecordDataForListView(recordType, listViewKey, searchTerm = null) {
        const listViewsData = this.pickerData[recordType].listViewsData;
        const requestTime = Date.now();
        if (listViewsData[listViewKey] !== undefined &&
            Object.keys(listViewsData[listViewKey]).length > 0 &&
            listViewsData[listViewKey].records &&
            !searchTerm) {
            return new Promise(function(resolve, reject) {
                const recordsData = listViewsData[listViewKey].records;
                recordsData.requestTime = requestTime;
                resolve(recordsData);
            });
        } else {
            return this.fetchDescribeQuery_(
                recordType,
                listViewKey).then(query => {
                return this.fetchRecordsDataByQuery_(query, searchTerm)
                    .then(recordsData => {
                        if (searchTerm == null || searchTerm.length == 0) {
                            const data = listViewsData[listViewKey];
                            data.records = recordsData;
                            data.lastFetchedTime = Date.now();
                            this.pickerData[recordType].listViewsData[
                                listViewKey
                            ] = data;
                        }
                        const retRecordsData = recordsData;
                        retRecordsData.requestTime = requestTime;
                        return retRecordsData;
                    })
                    .catch(errorMessage => {
                        // should throw exception with the time stamp
                        throw errorMessage + " requestTime:" + requestTime;
                    });
            });
        }
    }

    fetchDescribeQuery_(recordType, listViewKey) {
        const targetQuery = this.pickerData[recordType].listViewsData[
            listViewKey
        ].query;
        if (targetQuery) {
            return new Promise(function(resolve, reject) {
                resolve(targetQuery);
            });
        } else {
            const describeUrl = this.pickerData[recordType].listViewsData[
                listViewKey
            ].describeUrl;
            return this.getClient()
                .fetchApiLink(describeUrl)
                .then(ResponseHandler.parseListViewsDescribe)
                .then(query => {
                    this.pickerData[recordType].listViewsData[
                        listViewKey
                    ].query = query;
                    return query;
                });
        }
    }

    isRecent(data) {
        const recencyThreshold = 1000 * 60 * 5;
        const now = Date.now();
        return data.lastFetchedTime + recencyThreshold > now;
    }

    isExpired() {
        return SUPPORTED_RECORD_TYPES.some(
            type => !this.isRecent(this.pickerData[type].schema));
    }

    getRecordTypes() {
        return this.get("recordTypes");
    }

    setRecordTypes(recordTypes) {
        return this.set("recordTypes", recordTypes);
    }

    useSandbox() {
        return this.get("useSandbox");
    }

    setUseSandbox(useSandbox) {
        return this.set("useSandbox", useSandbox);
    }

    getInstanceUrl() {
        return this.get("instanceUrl");
    }

    setInstanceUrl(instanceUrl) {
        return this.set("instanceUrl", instanceUrl);
    }

    getListViewsForType(recordType) {
        return Object.values(this.pickerData[recordType].listViewsData);
    }

    getRelatedListsForType(recordType) {
        return this.getRecordTypes()[recordType].relatedLists;
    }

    getSchemaForType(recordType) {
        const storedSchema = this.getRecordTypes()[recordType].schema;
        if (Object.keys(storedSchema).length !== 0) {
            return storedSchema;
        } else {
            return this.pickerData[recordType].schema;
        }
    }

    getSelectedRecord() {
        return this.get("selectedRecord");
    }

    setSelectedRecord(recordId) {
        this.clearSelectedRecord();
        const recordTypes = this.getRecordTypes();
        const ownerId = quip.apps.getViewingUser().getId();
        for (let recordType of SUPPORTED_RECORD_TYPES) {
            recordTypes[recordType].schema = this.pickerData[recordType].schema;
            recordTypes[recordType].ownerId = ownerId;
        }
        this.setRecordTypes(recordTypes);
        this.set("selectedRecord", {
            recordId: recordId,
            ownerId: ownerId,
        });
        this.getSelectedRecord().fetchData();
        const metricArgs = {
            action: "selected_record",
            record_type: this.getSelectedRecord().getType(),
        };
        const metricName = this.getSelectedRecord().getMetricName();
        quip.apps.recordQuipMetric(metricName, metricArgs);
    }

    clearSelectedRecord() {
        if (this.getSelectedRecord()) {
            this.getSelectedRecord().clear();
        }
        this.clear("selectedRecord");
    }

    loadPlaceholderData(placeholerData) {
        const recordTypes = this.getRecordTypes();
        recordTypes[placeholerData.type].schema = placeholerData.schema;
        this.setRecordTypes(recordTypes);
        this.set("selectedRecord", {
            recordId: placeholerData.recordId,
            isPlaceholder: true,
        });
        this.getSelectedRecord().loadPlaceholderData(placeholerData);
    }

    setDom(node) {
        this.domNode = node;
    }

    getDom() {
        return this.domNode;
    }
}
