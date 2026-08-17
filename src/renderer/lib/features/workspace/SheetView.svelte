<script lang="ts">
  import {t} from '../../../i18n';

  export let title = '';
  export let columns = 6;
  export let rows = 14;

  const columnName = (index: number) => String.fromCharCode(65 + index);
</script>

<div class="artifact-draft spreadsheet-draft" aria-label={title || $t('view.spreadsheet')}>
  <table>
    <thead>
      <tr>
        <th scope="col"><span class="visually-hidden">{$t('view.row')}</span></th>
        {#each Array.from({length: columns}, (_, index) => index) as column (column)}
          <th scope="col">{columnName(column)}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each Array.from({length: rows}, (_, index) => index) as row (row)}
        <tr>
          <th scope="row">{row + 1}</th>
          {#each Array.from({length: columns}, (_, index) => index) as column (column)}
            <td><input aria-label={`${columnName(column)}${row + 1}`}/></td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
