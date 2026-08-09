<script lang="ts">
	import Markdown from '$lib/md/Markdown.svelte';
	import type { ReviewComment, ReviewThread } from '$lib/source';
	import Pill from '$lib/ui/Pill.svelte';
	import { ago, count } from '$lib/ui/format';
	import Avatar from './Avatar.svelte';

	/**
	 * One review thread — DESIGN.md §5: "8px radius card, indented 60px from the
	 * gutter, avatar + author + relative time, status pill right-aligned, replies
	 * separated by a hairline".
	 *
	 * Comment bodies go through our own Markdown parser, never through
	 * `{@html}`. Phase 3 settled that for READMEs and the argument is stronger
	 * here: a README is written by whoever owns the repository, and a review
	 * comment is written by anyone who can comment on the pull request.
	 * ARCHITECTURE.md §11 lists the token in browser storage against "XSS is a
	 * real risk", and rendering a stranger's markup into the document that holds
	 * it is the shortest path from that risk to a loss.
	 *
	 * **A thread that has lost its line still says where it was.** GitHub sends
	 * `line: null` once the anchor has moved out from under a comment, and only
	 * `originalLine` survives. PLAN.md Phase 7 asks for the head SHA to be stored
	 * with every thread so a comment can be placed anyway; `originalCommit` is
	 * that SHA, and it is what turns "we cannot show you where this was" into
	 * "line 42, as the file stood at `8888888`".
	 */
	interface Props {
		thread: ReviewThread;
		/** Where the anchored line can be read. Absent when it cannot be placed. */
		lineHref?: string | null;
		/** Where the conversation itself lives, since replying is out of scope. */
		outHref: string;
		compact?: boolean;
	}

	let { thread, lineHref = null, outHref, compact = false }: Props = $props();

	const first = $derived<ReviewComment | undefined>(thread.comments[0]);
	const replies = $derived(thread.comments.slice(1));
	const hidden = $derived(Math.max(0, thread.totalComments - thread.comments.length));

	/** The line as it is now, or the line it was written against. */
	const at = $derived(thread.line ?? thread.originalLine);
	const placed = $derived(thread.line !== null);
	const writtenAt = $derived(first?.commitOid ?? null);
</script>

<article class="thread" class:compact aria-label="Review thread on {thread.path}">
	<header class="head">
		<span class="path mono" title={thread.path}>{thread.path}</span>
		{#if at !== null}
			{#if lineHref}
				<a class="at mono" href={lineHref} title="Read this line">
					{thread.side === 'LEFT' ? '−' : '+'}{at}
				</a>
			{:else}
				<span class="at mono">{thread.side === 'LEFT' ? '−' : '+'}{at}</span>
			{/if}
		{/if}

		<span class="pills">
			{#if thread.isResolved}
				<Pill title={thread.resolvedBy ? `Resolved by ${thread.resolvedBy}` : 'Resolved'}>
					Resolved
				</Pill>
			{:else}
				<!-- Amber, which DESIGN.md §3 spends on exactly this and on a force
				     push you have not seen. The word carries it too. -->
				<Pill tone="warn" title="Nobody has resolved this">Unresolved</Pill>
			{/if}
			{#if !placed}
				<Pill
					title={writtenAt
						? `Written against ${writtenAt.slice(0, 7)}; the line has moved since`
						: 'The line this was written on has moved'}
				>
					Moved{writtenAt ? ` · ${writtenAt.slice(0, 7)}` : ''}
				</Pill>
			{:else if thread.isOutdated}
				<Pill title="The file changed after this was written">Outdated</Pill>
			{/if}
		</span>
	</header>

	{#if first}
		<div class="comment">
			<div class="who">
				<Avatar login={first.authorLogin} url={first.avatarUrl} />
				<b>{first.authorLogin ?? 'unknown'}</b>
				<span class="when" title={first.createdAt}>{ago(first.createdAt)}</span>
			</div>
			<div class="body"><Markdown source={first.body} /></div>
		</div>
	{/if}

	{#each replies as reply (reply.id)}
		<div class="comment reply">
			<div class="who">
				<Avatar login={reply.authorLogin} url={reply.avatarUrl} />
				<b>{reply.authorLogin ?? 'unknown'}</b>
				<span class="when" title={reply.createdAt}>{ago(reply.createdAt)}</span>
			</div>
			<div class="body"><Markdown source={reply.body} /></div>
		</div>
	{/each}

	<footer class="foot">
		{#if hidden > 0}
			<span class="more">{count(hidden)} more {hidden === 1 ? 'reply' : 'replies'}</span>
		{/if}
		<!-- Replying is a write, and ARCHITECTURE.md §1 puts writes out of scope
		     for v1. A link that works beats a box that does not. -->
		<a class="out" href={outHref} target="_blank" rel="noopener noreferrer external">
			Reply on github.com
		</a>
	</footer>
</article>

<style>
	.thread {
		/* DESIGN.md §5: 8px radius, indented 60px from the gutter. */
		margin: 8px var(--pad-main) 8px 60px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--raise);
		overflow: hidden;
	}

	.compact {
		margin: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-bottom: 1px solid var(--bd);
		min-width: 0;
	}

	.path {
		font-size: 11.5px;
		color: var(--tx2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}

	.at {
		font-size: 11px;
		color: var(--acc-tx);
		flex: none;
		transition: color 120ms;
	}

	a.at:hover {
		color: var(--tx);
	}

	.pills {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}

	.comment {
		padding: 8px 10px;
	}

	.reply {
		border-top: 1px solid var(--bd);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}

	.who b {
		color: var(--tx);
		font-weight: 500;
	}

	.when {
		color: var(--tx3);
		font-size: 11px;
	}

	.body {
		margin-top: 5px;
		padding-left: 25px;
		font-size: 12px;
		color: var(--tx2);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border-top: 1px solid var(--bd);
		font-size: 11px;
		color: var(--tx3);
	}

	.out {
		margin-left: auto;
		color: var(--tx3);
		transition: color 120ms;
	}

	.out:hover {
		color: var(--acc-tx);
	}
</style>
