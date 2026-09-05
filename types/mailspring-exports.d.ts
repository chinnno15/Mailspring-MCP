declare module 'mailspring-exports'
{
	interface Attribute
	{
		equal(val: any): Matcher;
		not(val: any): Matcher;
		contains(val: string): Matcher;
		containsAny(val: string[]): Matcher;
		in(val: any[]): Matcher;
		notIn(val: any[]): Matcher;
		greaterThan(val: any): Matcher;
		lessThan(val: any): Matcher;
		greaterThanOrEqualTo(val: any): Matcher;
		lessThanOrEqualTo(val: any): Matcher;
		gt(val: any): Matcher;
		lt(val: any): Matcher;
		gte(val: any): Matcher;
		lte(val: any): Matcher;
		like(val: string): Matcher;
		startsWith(val: string): Matcher;
		descending(): SortDescriptor;
		ascending(): SortDescriptor;
	}

	interface Matcher
	{
	}

	const Matcher:
	{
		Or(matchers: Matcher[]): Matcher;
		And(matchers: Matcher[]): Matcher;
		Not(matchers: Matcher[]): Matcher;
		Search(query: string): Matcher;
	};
	interface SortDescriptor { }

	interface ModelQuery<T> extends Promise<T[]>
	{
		where(matchers: Matcher[]): ModelQuery<T>;
		whereAny(matchers: Matcher[]): ModelQuery<T>;
		search(query: string): ModelQuery<T>;
		order(sort: SortDescriptor | SortDescriptor[]): ModelQuery<T>;
		limit(n: number): ModelQuery<T>;
		offset(n: number): ModelQuery<T>;
		include(attr: Attribute): ModelQuery<T>;
		includeAll(): ModelQuery<T>;
		count(): Promise<number>;
		one(): Promise<T | null>;
	}

	interface SingleModelQuery<T> extends Promise<T | null>
	{
		include(attr: Attribute): SingleModelQuery<T>;
		includeAll(): SingleModelQuery<T>;
	}

	interface ModelAttributes
	{
		[key: string]: Attribute;
	}

	interface MailspringContact
	{
		name: string;
		email: string;
	}

	interface MailspringFolder
	{
		id: string;
		path: string;
		role: string;
		displayName: string;
		accountId: string;
	}

	interface MailspringLabel
	{
		id: string;
		path: string;
		role: string;
		displayName: string;
		accountId: string;
	}

	interface MailspringFile
	{
		id: string;
		filename: string;
		contentType: string;
		size: number;
	}

	interface MailspringThread
	{
		id: string;
		accountId: string;
		subject: string;
		snippet: string;
		unread: boolean;
		starred: boolean;
		firstMessageTimestamp: number;
		lastMessageReceivedTimestamp: number;
		lastMessageSentTimestamp: number;
		participants: MailspringContact[];
		attachmentCount: number;
		folders: MailspringFolder[];
		labels: MailspringLabel[];
		categories: any[];
		messages(opts?: { includeHidden?: boolean }): Promise<MailspringMessage[]>;
	}

	interface MailspringMessage
	{
		id: string;
		accountId: string;
		subject: string;
		snippet: string;
		date: number;
		draft: boolean;
		unread: boolean;
		starred: boolean;
		threadId: string;
		body: string;
		from: MailspringContact[];
		to: MailspringContact[];
		cc: MailspringContact[];
		bcc: MailspringContact[];
		replyTo: MailspringContact[];
		files: MailspringFile[];
		folder: MailspringFolder | null;
		plaintext: boolean;
		replyToHeaderMessageId: string | null;
		headerMessageId: string;
	}

	interface MailspringAccount
	{
		id: string;
		name: string;
		emailAddress: string;
		provider: string;
	}

	const AccountStore:
	{
		accounts(): MailspringAccount[];
		accountForId(id: string): MailspringAccount | null;
	};

	interface MailspringContactRecord
	{
		id: string;
		email: string;
		name: string;
		refs: number;
		hidden: boolean;
		source: string;
	}

	interface ModelClass<T>
	{
		attributes: Record<string, Attribute>;
	}

	const Thread: ModelClass<MailspringThread>;
	const Message: ModelClass<MailspringMessage>;
	const Contact: ModelClass<MailspringContactRecord>;
	const Folder: ModelClass<MailspringFolder>;
	const Label: ModelClass<MailspringLabel>;

	const DatabaseStore:
	{
		find<T>(klass: ModelClass<T>, id: string): SingleModelQuery<T>;
		findBy<T>(klass: ModelClass<T>, predicates: Matcher[]): SingleModelQuery<T>;
		findAll<T>(klass: ModelClass<T>): ModelQuery<T>;
		count<T>(klass: ModelClass<T>, predicates?: Matcher[]): Promise<number>;
		run<T>(query: ModelQuery<T>): Promise<T[]>;
	};

	const ComponentRegistry:
	{
		register(component: any, options: { role: string }): void;
		unregister(component: any): void;
	};

	interface MailspringTask { }

	const TaskFactory:
	{
		tasksForArchiving(opts: { threads: MailspringThread[]; source: string }): MailspringTask[];
		tasksForMovingToTrash(opts: { threads: MailspringThread[]; source: string }): MailspringTask[];
	};

	const Actions:
	{
		queueTask(task: MailspringTask): void;
		queueTasks(tasks: MailspringTask[]): void;
	};
}

declare const AppEnv:
{
	getConfigDirPath(): string;
};
