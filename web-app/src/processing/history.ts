import {originalRecipe} from './types.js';
import type {ProcessingRecipe,SavedEdit} from './types.js';
export interface EditRevision {recipe:ProcessingRecipe; history:ProcessingRecipe[]; redo:ProcessingRecipe[]}
/** Per-page revisions remain independent, including when a batch is interrupted. */
export function editRevision(previous:SavedEdit|undefined,direction:'undo'|'redo'):EditRevision|undefined {
  if(!previous)return;
  const history=previous.history,redo=previous.redo??[];
  const target=(direction==='undo'?history:redo).at(-1);if(!target)return;
  return structuredClone({recipe:target,
    history:direction==='undo'?history.slice(0,-1):[...history,previous.recipe??originalRecipe()].slice(-20),
    redo:direction==='undo'?[...redo,previous.recipe].slice(-20):redo.slice(0,-1)});
}
