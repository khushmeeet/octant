<script lang="ts">
	import { page } from '$app/state';
	import { parseTree } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import TreeScreen from '$lib/tree/TreeScreen.svelte';

	/**
	 * A repository's front page: its tree, at whatever its default branch is.
	 *
	 * The default branch is addressed by omission rather than by name, so this
	 * URL stays correct after a rename and does not have to wait on the
	 * repository summary to be built. `parseTree` turns the absent `rev` param
	 * into the `null` that means exactly that.
	 */
	const address = $derived(parseTree(page.params));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<TreeScreen {address} />
