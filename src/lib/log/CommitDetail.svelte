<script lang="ts">
	import { commitHref } from '$lib/nav/paths';
	import {
		logAuthor,
		type ChangedFile,
		type CommitDetail as Detail,
		type LogCommit,
		type RepoRef
	} from '$lib/source';
	import type { SourceError } from '$lib/source/errors';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import { ago, count } from '$lib/ui/format';

	/**
	 * The selected commit, below the table — PLAN.md Phase 5's "selected-commit
	 * detail panel: full message, touched files".
	 *
	 * It fills in two beats, deliberately. Everything the log query already
	 * carries — the whole message, the author, the counts, the delta bar — is
	 * there the instant the cursor lands, because pressing `j` should never make
	 * the screen go blank. The file list is a second read (REST, one commit), so
	 * it arrives a moment later and only once the cursor has settled: holding
	 * `j` down through fifty rows must not be fifty requests.
	 *
	 * That second read is the same query the commit screen makes, under the same
	 * key. So resting on a row pays for the screen `enter` opens, and by the time
	 * you press it the diff is already on disk.
	 */
	interface Props {
		repo: RepoRef;
		commit: LogCommit;
		/** The file list, once it has arrived. */
		detail: Detail | null;
		loading?: boolean;
		error?: SourceError | null;
	}

	let { repo, commit, detail, loading = false, error = null }: Props = $props();

	const href = $derived(commitHref(repo, commit.oid));

	/** What GitHub's own diffstat calls them, in one character. */
	const MARK: Record<ChangedFile['status'], string> = {
		added: 'A',
		removed: 'D',
		modified: 'M',
		renamed: 'R',
		copied: 'C',
		changed: 'M',
		unchanged: ' '
	};
</script>

<section class="detail" aria-label="Selected commit">
	<div class="top">
		<a class="sha mono" {href} title="Open this commit's diff">{commit.abbreviatedOid}</a>
		<span class="head">{commit.headline}</span>
		<span class="by">{logAuthor(commit)}</span>
		<span class="when" title={commit.committedDate}>{ago(commit.committedDate)}</span>
		<a class="open" {href}>Open the diff</a>
	</div>

	<!-- Message beside files rather than above them. The pane is wide and short,
	     so stacking them gives each a few clipped lines; side by side, a message
	     of any length and a commit of any size both read. -->
	<div class="halves">
		{#if commit.body.trim()}
			<pre class="body">{commit.body.trim()}</pre>
		{/if}

		<div class="files" class:wide={!commit.body.trim()}>
			{#if detail}
				{#if detail.files.length === 0}
					<p class="hint">This commit touched no files.</p>
				{:else}
					{#each detail.files as file (file.path)}
						<a
							class="file"
							href={commitHref(repo, commit.oid, { file: file.path })}
							title="{file.path} — {file.status}"
						>
							<span class="mark mono" aria-hidden="true">{MARK[file.status]}</span>
							<span class="path mono">{file.path}</span>
							{#if file.previousPath}
								<span class="was mono" title="Renamed from {file.previousPath}"
									>← {file.previousPath}</span
								>
							{/if}
							<DeltaBar additions={file.additions} deletions={file.deletions} />
							<span class="num mono"
								><b class="add">+{count(file.additions)}</b><b class="del"
									>−{count(file.deletions)}</b
								></span
							>
						</a>
					{/each}
					{#if detail.truncated}
						<p class="hint">
							GitHub sent the first {count(detail.files.length)} files of this commit, not all of them.
						</p>
					{/if}
				{/if}
			{:else if error}
				<p class="hint">{error.message}</p>
			{:else if loading}
				<p class="hint">
					{commit.changedFiles === null
						? 'Reading what it touched…'
						: `Reading ${count(commit.changedFiles)} ${commit.changedFiles === 1 ? 'file' : 'files'}…`}
				</p>
			{/if}
		</div>
	</div>
</section>

<style>
	.detail {
		border-top: 1px solid var(--bd);
		background: var(--side);
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: none;
		/* A pane, not a second screen: the table keeps most of the height. */
		height: 210px;
		max-height: 44%;
	}

	.halves {
		display: flex;
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--bd);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px var(--pad-main);
		flex: none;
		min-width: 0;
	}

	.sha {
		color: var(--acc-tx);
		flex: none;
		transition: color 120ms;
	}

	.sha:hover {
		color: var(--tx);
	}

	.head {
		color: var(--tx);
		font-weight: 500;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.by,
	.when {
		font-size: 12px;
		color: var(--tx3);
		flex: none;
	}

	.open {
		margin-left: auto;
		font-size: 12px;
		color: var(--tx2);
		flex: none;
		padding: 3px 8px;
		border-radius: var(--radius-item);
		transition:
			color 120ms,
			background-color 120ms;
	}

	.open:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.body {
		margin: 0;
		padding: 8px var(--pad-main);
		font-family: inherit;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--tx2);
		white-space: pre-wrap;
		flex: 0 1 46ch;
		min-width: 0;
		overflow-y: auto;
		border-right: 1px solid var(--bd);
	}

	.files {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding: 4px 0;
	}

	/* Nothing to sit beside, so the file list takes the width. */
	.files.wide {
		flex: 1 1 100%;
	}

	.file {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 24px;
		padding: 0 var(--pad-main);
		color: var(--tx2);
		transition: background-color 120ms;
	}

	.file:hover {
		background: var(--hover);
	}

	.mark {
		width: 12px;
		flex: none;
		color: var(--tx3);
		font-size: 11px;
		text-align: center;
	}

	.path {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.was {
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		max-width: 30%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.num {
		flex: none;
		width: 96px;
		font-size: 11px;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}

	.add {
		color: var(--ok);
		font-weight: 400;
	}

	.del {
		color: var(--no);
		font-weight: 400;
	}

	.hint {
		margin: 0;
		padding: 4px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}
</style>
