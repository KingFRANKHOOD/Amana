const translationDictionaryRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require translation dictionaries to declare their English key set",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");

    if (!filename.endsWith("/src/i18n/dictionaries/fr.ts")) {
      return {};
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.id.name !== "fr") {
          return;
        }

        const typeAnnotation = node.id.typeAnnotation?.typeAnnotation;
        const isTypedTranslationRecord =
          typeAnnotation?.type === "TSTypeReference" &&
          typeAnnotation.typeName.type === "Identifier" &&
          typeAnnotation.typeName.name === "Record" &&
          typeAnnotation.typeParameters?.params.length === 2 &&
          typeAnnotation.typeParameters.params[0].type === "TSTypeReference" &&
          typeAnnotation.typeParameters.params[0].typeName.type === "Identifier" &&
          typeAnnotation.typeParameters.params[0].typeName.name === "TranslationKeys";

        if (!isTypedTranslationRecord) {
          context.report({
            node: node.id,
            message: 'The French dictionary must be typed as Record<TranslationKeys, string>.',
          });
        }
      },
    };
  },
};

export default translationDictionaryRule;