import { Diposables } from "../pomelo-common";
import { PomeloEditor } from "../pomelo-editor";
import { IPomeloBlockConstructor, PomeloBlock } from "../pomelo-renderer";

export interface IPomeloPlugin {
  Name: string;

  /**
   * The block registered by the plugin.
   */
  blocks?: IPomeloBlockConstructor[];

  /**
   * Will be triggered when the editor is initialized.
   */
  onInitialized?(editor: PomeloEditor): void;

  /**
   * Will be triggerd when the editor is mounted with dom container and children elements
   * @param editor 
   */
  onEditorDidMount?(editor: PomeloEditor): void;

  onEditorWillUnmount?(editor: PomeloEditor): void;

  /**
   * Will be triggered when the editor is destroyed.
   */
  dispose?(): void;

  /**
   * Will be triggered when block is mounted
   */
  onBlockDidMount?(block: PomeloBlock): void;

  /**
   * Will be triggered when block is unmounted
   */
  onBlockDidUnMount?(block: PomeloBlock): void;

  /**
   * Will be triggered when selection is changed
   */
  // onBlockSelectionChange?(selectionState: SelectionState): void;
}

export abstract class PomeloPlugin extends Diposables implements IPomeloPlugin {
  Name: string;
  blocks?: IPomeloBlockConstructor[];
  editor: PomeloEditor;
  abstract onEditorDidMount(editor?: PomeloEditor): void;
  // onBlockSelectionChange?(selectionState: SelectionState): void;

  onInitialized(editor: PomeloEditor) {
    this.editor = editor;
  }
}

