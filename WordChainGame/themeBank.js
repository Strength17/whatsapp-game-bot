// ============================================================
//  WordChainGame/themeBank.js
//  Two wide, common-word theme families instead of narrow slang
//  lists — "Animals" (mammals, birds, insects, reptiles, all one
//  umbrella) and "Food" (fruit, vegetables, dishes, all one
//  umbrella). These auto-rotate live during a match based on a
//  qualification streak (see config.THEME_ROTATION_QUALIFY /
//  gameEngine.maybeRotateTheme) — never admin-picked mid-match.
//
//  Admin-editable via /wcg addthemeword & /wcg removethemeword,
//  same as before — this file just seeds the shared words.json
//  on first boot. Still unioned with the offline dictionary,
//  never a replacement, so chains can't dead-end (dictionary.js).
// ============================================================

const DEFAULT_WORDS = {
    // activeTheme is now the LIVE, engine-managed value — 'none' at the
    // start of every match, then auto-rotated through THEME_ROTATION_ORDER
    // as the group qualifies. It is no longer admin-settable mid-match.
    activeTheme: 'none',
    themes: {
        animals: [
            'ant', 'bat', 'bear', 'bee', 'bird', 'boar', 'bull', 'calf', 'camel',
            'cat', 'chick', 'cobra', 'colt', 'cow', 'crab', 'crane', 'crow',
            'deer', 'dingo', 'dog', 'dove', 'duck', 'eagle', 'eel', 'elk',
            'emu', 'ewe', 'ferret', 'finch', 'fish', 'flea', 'fly', 'fox',
            'frog', 'gecko', 'goat', 'goose', 'gopher', 'gorilla', 'grouse',
            'gull', 'hare', 'hawk', 'hen', 'heron', 'hippo', 'horse', 'hound',
            'hyena', 'ibis', 'jackal', 'jaguar', 'kite', 'koala', 'lamb',
            'lark', 'lemur', 'leopard', 'lion', 'lizard', 'llama', 'lobster',
            'locust', 'lynx', 'macaw', 'magpie', 'mantis', 'mare', 'marten',
            'mink', 'mole', 'monkey', 'moose', 'moth', 'mouse', 'mule',
            'newt', 'ocelot', 'octopus', 'orca', 'otter', 'owl', 'ox',
            'oyster', 'panda', 'panther', 'parrot', 'peacock', 'pelican',
            'penguin', 'pig', 'pigeon', 'pony', 'possum', 'prawn', 'puma',
            'quail', 'rabbit', 'raccoon', 'ram', 'rat', 'raven', 'rhino',
            'robin', 'rooster', 'salmon', 'seal', 'shark', 'sheep', 'shrew',
            'shrimp', 'skunk', 'sloth', 'snail', 'snake', 'sparrow', 'spider',
            'squid', 'squirrel', 'stag', 'stork', 'swan', 'tapir', 'termite',
            'tiger', 'toad', 'trout', 'turkey', 'turtle', 'viper', 'vole',
            'vulture', 'walrus', 'wasp', 'weasel', 'whale', 'wolf', 'wombat',
            'worm', 'wren', 'yak', 'zebra'
        ],
        food: [
            'apple', 'apricot', 'avocado', 'bacon', 'bagel', 'banana', 'basil',
            'bean', 'beef', 'beet', 'berry', 'biscuit', 'bread', 'broccoli',
            'burger', 'burrito', 'butter', 'cabbage', 'cake', 'candy', 'carrot',
            'cashew', 'cereal', 'cheese', 'cherry', 'chicken', 'chili',
            'chocolate', 'chowder', 'churro', 'cinnamon', 'clove', 'cocoa',
            'coconut', 'cookie', 'corn', 'crab', 'cracker', 'cranberry',
            'cream', 'cucumber', 'cupcake', 'curry', 'custard', 'date',
            'donut', 'dumpling', 'egg', 'eggplant', 'fig', 'fish', 'flour',
            'fudge', 'garlic', 'ginger', 'grape', 'gravy', 'guava', 'ham',
            'hazelnut', 'honey', 'hotdog', 'hummus', 'jam', 'jelly', 'kale',
            'ketchup', 'kiwi', 'lasagna', 'leek', 'lemon', 'lentil', 'lettuce',
            'lime', 'lobster', 'macaroni', 'mango', 'maple', 'melon', 'milk',
            'mint', 'muffin', 'mushroom', 'mustard', 'noodle', 'nutmeg',
            'oat', 'olive', 'omelet', 'onion', 'orange', 'oregano', 'pancake',
            'papaya', 'paprika', 'parsley', 'pasta', 'peach', 'peanut',
            'pear', 'pecan', 'pepper', 'pickle', 'pie', 'pineapple', 'pizza',
            'plum', 'popcorn', 'potato', 'pretzel', 'pudding', 'pumpkin',
            'quiche', 'quinoa', 'radish', 'raisin', 'ramen', 'raspberry',
            'rice', 'risotto', 'roll', 'rosemary', 'salad', 'salmon', 'salsa',
            'salt', 'sandwich', 'sausage', 'shrimp', 'soda', 'soup', 'spinach',
            'squash', 'steak', 'stew', 'strawberry', 'sugar', 'sushi', 'syrup',
            'taco', 'tangerine', 'tart', 'tea', 'toast', 'tofu', 'tomato',
            'tortilla', 'truffle', 'tuna', 'turkey', 'turnip', 'vanilla',
            'waffle', 'walnut', 'watermelon', 'wheat', 'yam', 'yogurt', 'zucchini'
        ]
    }
}

module.exports = { DEFAULT_WORDS }
