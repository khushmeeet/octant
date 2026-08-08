<script lang="ts">
	import { page } from '$app/state';
	import CommitScreen from '$lib/commit/CommitScreen.svelte';
	import { parseCommit } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';

	/**
	 * One commit, and its diff. Addressed by SHA in practice — which is what
	 * makes it permanent in the cache — though the route accepts any revision
	 * GitHub can resolve.
	 */
	const address = $derived(parseCommit(page.params));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<CommitScreen {address} />
