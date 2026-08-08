<script lang="ts">
	import { page } from '$app/state';
	import { parseTree } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import TreeScreen from '$lib/tree/TreeScreen.svelte';

	/**
	 * A tree at a named revision, at the root or in a directory.
	 *
	 * `[rev]` is one segment and `[...path]` is the rest, which is why the
	 * revision is percent-encoded on the way in — see `nav/paths.ts` for why the
	 * split is decided by the URL rather than by a round trip.
	 */
	const address = $derived(parseTree(page.params));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<TreeScreen {address} />
