/**
 * Created by michbil on 20.12.16.
 */

import {AtomicBlockUtils, CompositeDecorator, ContentState, SelectionState, Editor, EditorState, Entity, RichUtils, CharacterMetadata, getDefaultKeyBinding,  Modifier,convertToRaw} from 'draft-js';
import {getImageObject} from '../JSONDocument.js';

var linkEditCallback;
var imageEditCallback;
import LinkEntity from '../EditorEntities/LinkEntity.js';
import ImageEntity from '../EditorEntities/ImageEntitiy.js';
import SocialMediaEntity from '../EditorEntities/SocialMediaEntity.js';

const isImageLink = (filename) => (/\.(gif|jpg|jpeg|tiff|png)$/i).test(filename);

export default class EntityTools {

    static setLinkEditCallback(cb) {
        linkEditCallback = cb;
    }
    static setImageEditCallback(cb) {
        imageEditCallback = cb;
    }

    /**
     * Creates link entity
     * @param title
     * @param url
     * @param desc
     * @returns {LINK}
     */
    static createLinkEntity(title,url,desc) {
        return Entity.create('LINK', 'MUTABLE', {
            linkTitle: title,
            linkUrl: url,
            linkDesc: desc,
            editCallback: linkEditCallback
        });
    }

    /**
     * Creates image or social entity
     * @param url
     * @param description
     * @param title
     * @returns {urlType}
     */
    static createImageSocialEntity(url,description,title) {
        const urlType = isImageLink(url) ? 'IMAGE' : 'SOCIAL';
        const entityKey = Entity.create(urlType, 'IMMUTABLE',
            {
                src: url ,
                description,
                title,
                editCallback: imageEditCallback
            });
        return entityKey;
    }

    static insertEntityKey(editorState, entityKey) {
        // AtomicBlockUtils is adding extra paragraph, TODO: make workaround without it
        const newEditorState = AtomicBlockUtils.insertAtomicBlock( // TODO: first point of redundant empty block creation
            editorState,
            entityKey,
            ' '
        );
        const _s =  EditorState.forceSelection(
            newEditorState,
            editorState.getCurrentContent().getSelectionAfter()
        );

        return _s;
    }


    static _getMentionContentBlock(contentBlocks,mention) {
        const block = contentBlocks[mention.block];

        if (!block) {
            console.warn("Cannot create mention",mention);
            throw new Error("Mention create error");
        }
        return block;
    }

    static _constructEntity(entityKey,editorState,contentBlocks,mention) {

        try {
            const key = this._getMentionContentBlock(contentBlocks,mention).getKey();
            return RichUtils.toggleLink(
                editorState,
                SelectionState.createEmpty(key).merge({
                    anchorOffset: mention.start,
                    focusKey: key,
                    focusOffset: mention.end
                }),
                entityKey
            );
        } catch (e){
            console.error("Error mapping a mention",e);
            return editorState;
        }
    }

    /**
     * Inserts mention into editor state
     * @param editorState
     * @param contentBlocks
     * @param mention
     * @returns {*} new editorState
     */

    static constructMention(editorState, contentBlocks, mention) {
        const entityKey = this.createLinkEntity(mention.linkWord,mention.url,mention.linkDesc);
        return this._constructEntity(entityKey,editorState,contentBlocks,mention);
    }

    /**
     * Inserts image into editorState
     * @param editorState
     * @param contentBlocks
     * @param mention
     * @returns {*} new editorState
     */

    static constructImage(editorState, contentBlocks, mention) {
        const metaData = {
            block: this._getMentionContentBlock(contentBlocks,mention),
            data: getImageObject(mention.src,mention.name,mention.description)
        };
        return this.constructSocial(editorState,metaData);
    }

    /**
     * Inserts social entity into editorState from metablock generated by LDJSONDocument
     * @param editorState - prev editorState
     * @param metaBlock
     * @returns {*} new editorState
     */

    static constructSocial(editorState,metaBlock) {
        const contentBlock = metaBlock.block;
        const blockData = metaBlock.data;
        let entityKey;
        if (blockData["@type"] == "ImageObject") {
            entityKey = this.createImageSocialEntity(blockData.contentUrl,blockData.name,blockData.description);
        } else {
            entityKey = this.createImageSocialEntity(blockData.sharedContent.url,blockData.sharedContent.headline,blockData.sharedContent.about);
        }
        const key = contentBlock.getKey();
        const _editorState = EditorState.forceSelection(editorState,SelectionState.createEmpty(key));
        return EntityTools.insertEntityKey(_editorState,entityKey);
    }
}

export const getSelection = (editorState) => {
    var title = '';
    const selectionState = editorState.getSelection();
    const blockKey = selectionState.getAnchorKey();
    const contentBlocks = editorState.getCurrentContent().getBlocksAsArray();
    var start = selectionState.getStartOffset();
    var end = selectionState.getEndOffset();

    contentBlocks.forEach((block) => {
        if(block.key === blockKey){
            title = block.text.slice(start, end);
        }
    });
    return title;
};


// helper function
const findEntitiesOfType = (type) => (contentBlock, callback) => {
    contentBlock.findEntityRanges(
        (character) => {
            const entityKey = character.getEntity();
            return (
                !!entityKey &&
                Entity.get(entityKey).getType() === type
            );
        },
        callback
    );
};



export const findLinkEntities   = findEntitiesOfType('LINK');
export const findImageEntities  = findEntitiesOfType('IMAGE');
export const findSocialEntities = findEntitiesOfType('SOCIAL');


export function createEditorState(metaBlocks, mentions, images) {
    const decorator = new CompositeDecorator([{
        strategy: findLinkEntities,
        component: LinkEntity
    },{
        strategy: findImageEntities,
        component: ImageEntity
    },
        {
            strategy: findSocialEntities,
            component: SocialMediaEntity
        }
    ]);

//    console.log("OrderedBlocks after import:");

    const valuesToKeys = (hash,value)=>{
        const e = value.block;
  //      console.log("BLOCK", value.order, e.getType(),e.getText());
        let key = value['order']+1;
        hash[key] = value['block'];
        return hash;
    };
    const orderedBlocks = metaBlocks.reduce(valuesToKeys,{});

    //console.log(orderedBlocks);
    const contentBlocks = metaBlocks.map(x => x.block);

    let editorState = contentBlocks.length > 0 ?
        EditorState.createWithContent(ContentState.createFromBlockArray(contentBlocks), decorator) :
        EditorState.createEmpty(decorator);

    editorState = metaBlocks.reduce((editorState,metaBlock) => metaBlock.data ? EntityTools.constructSocial(editorState,metaBlock) : editorState, editorState);
    if (images) {
        editorState = images.reduce((editorState,mention) => EntityTools.constructImage(editorState,orderedBlocks,mention),editorState);
    }

    return mentions.reduce((editorState,mention) => EntityTools.constructMention(editorState,orderedBlocks,mention),editorState);

}


function appendHttp(url) {
    if (!/^https?:\/\//i.test(url)) {
        return 'http://' + url;
    }
    return url;
}


export function createNewLink(editorState, titleValue,urlValue,descValue) {

    urlValue = appendHttp(urlValue);

    const entityKey = EntityTools.createLinkEntity(titleValue,urlValue,descValue);

    const e = Entity.get(entityKey).getData();
    console.log(e);

    let _editorState = RichUtils.toggleLink(
        editorState,
        editorState.getSelection(),
        entityKey
    );
    return _editorState;
}

export function createNewImage (editorState,url,description,title) {
    const entityKey = EntityTools.createImageSocialEntity(url,description,title);
    return EntityTools.insertEntityKey(editorState,entityKey);
}


export function removeEntity(editorState,entityKeyToRemove) {
    let newState = null;

    editorState.getCurrentContent().getBlockMap().map(block => {
        block.findEntityRanges(char => {
            let entityKey = char.getEntity();
            return !!entityKey && entityKey === entityKeyToRemove;
        }, (anchorOffset, focusOffset) => {
            let _editorState = RichUtils.toggleLink(
                editorState,
                SelectionState.createEmpty(block.getKey()).merge({
                    anchorOffset,
                    focusKey: block.getKey(),
                    focusOffset
                }),
                null
            );
            newState = _editorState;
        });
    });
    return newState;
}