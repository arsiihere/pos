import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import { recipeHref } from './recipes';

// 08b §8.5 (B17, AD-9): a 01c / 08a write refused with 409 CONFIG_IN_USE { used_by: { entity: 'recipe', ids } } says
// "archive the recipe first" with a link to each recipe that holds the row.
export function RecipeInUse({ ids }: { ids: readonly string[] }) {
  return (
    <div className="pos-banner pos-banner--danger" role="alert" data-recipe-in-use="">
      <Icon name="alert" />
      <p>{t('recipe_in_use.text')}</p>
      {ids.length > 0 && (
        <div className="pos-banner__action pos-row">
          {ids.map((id) => (
            <a key={id} className="pos-btn" href={recipeHref(id)}>
              {t('recipe_in_use.open')}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
