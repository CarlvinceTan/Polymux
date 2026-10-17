import SwiftUI
import PolymuxKit

struct EmojiPicker: View {
    let anchor: CGRect
    let container: CGSize
    var trace = SignpostTrace()
    let choose: (String) -> Void
    @State private var query = ""
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 8)

    var body: some View {
        VStack(spacing: 8) {
            TextField("Search emoji", text: $query)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Search emoji")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(EmojiGroup.table) { group in
                        let matches = group.entries.filter {
                            query.isEmpty || ($0.keywords + " " + group.name + " " + $0.symbol)
                                .localizedCaseInsensitiveContains(query)
                        }
                        if !matches.isEmpty {
                            Text(group.name).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                            LazyVGrid(columns: columns, spacing: 4) {
                                ForEach(matches) { entry in
                                    Button {
                                        InstantUI.interval("EmojiChoice", budget: InstantUI.stateBudget, trace: trace) { choose(entry.symbol) }
                                    } label: {
                                        Text(entry.symbol).font(.system(size: 24))
                                            .frame(maxWidth: .infinity).frame(height: 32)
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(entry.keywords)
                                }
                            }
                        }
                    }
                    if !query.isEmpty && !EmojiGroup.table.contains(where: { group in
                        group.entries.contains { ($0.keywords + " " + group.name + " " + $0.symbol).localizedCaseInsensitiveContains(query) }
                    }) {
                        Text("No emoji found").foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(12)
        .frame(height: min(360, max(0, container.height - 16)))
        .messagePosition(anchor: anchor, container: container, preferred: CGSize(width: 320, height: 360))
    }
}

private struct EmojiEntry: Identifiable {
    let symbol: String
    let keywords: String
    var id: String { symbol }
}

private struct EmojiGroup: Identifiable {
    let name: String
    let entries: [EmojiEntry]
    var id: String { name }

    init(_ name: String, _ source: String) {
        self.name = name
        entries = source.split(separator: ";").map { item in
            let words = item.split(separator: " ", maxSplits: 1)
            return EmojiEntry(symbol: String(words[0]), keywords: words.count > 1 ? String(words[1]) : name)
        }
    }

    static let table = [
        EmojiGroup("Smileys & emotion", "😀 happy grin;😃 smile happy;😄 smile laugh;😁 grin teeth;😆 laugh;😅 sweat relief;😂 tears joy laugh;🤣 rolling laugh;🥲 happy tear;😊 blush smile;😇 angel innocent;🙂 smile;🙃 upside down;😉 wink;😍 love heart eyes;🥰 love hearts;😘 kiss;😗 kiss;😙 kiss smile;😚 kiss blush;😋 yummy delicious;😛 tongue;😜 wink tongue;🤪 crazy silly;😝 tongue squint;🤑 money rich;🤗 hug;🤭 giggle;🫢 surprise gasp;🫣 peek;🤫 quiet hush;🤔 think;🫡 salute;🤐 zip quiet;🤨 eyebrow skeptical;😐 neutral;😑 expressionless;😶 speechless;🫥 invisible;😏 smirk;😒 unimpressed;🙄 eye roll;😬 grimace;😮‍💨 sigh;🤥 lie;😌 relieved;😔 sad pensive;😪 sleepy;🤤 drool;😴 sleep;😷 mask sick;🤒 sick fever;🤕 hurt bandage;🤢 nauseous;🤮 vomit;🤧 sneeze;🥵 hot;🥶 cold;🥴 dizzy;😵 dizzy;🤯 mind blown;🤠 cowboy;🥳 party celebrate;🥸 disguise;😎 cool sunglasses;🤓 nerd;🧐 monocle;😕 confused;🫤 unsure;😟 worried;🙁 sad;☹️ frown;😮 surprised;😯 hushed;😲 astonished;😳 embarrassed;🥺 pleading;🥹 tears;😦 frown;😧 anguish;😨 afraid;😰 anxious;😥 sad relief;😢 cry;😭 sob;😱 scream;😖 frustrated;😣 persevere;😞 disappointed;😓 sweat;😩 weary;😫 tired;🥱 yawn;😤 angry huff;😡 rage;😠 angry;🤬 swear;😈 devil;👿 devil angry;💀 skull;☠️ danger;💩 poop;🤡 clown;👻 ghost;👽 alien;🤖 robot;😺 cat smile;😸 cat grin;😹 cat laugh;😻 cat love;😼 cat smirk;😽 cat kiss;🙀 cat shock;😿 cat cry;😾 cat angry;💋 kiss lips;💌 love letter;💘 cupid;💝 gift heart;💖 sparkling heart;💗 growing heart;💓 beating heart;💞 revolving hearts;💕 two hearts;💟 heart;❣️ heart exclamation;💔 broken heart;❤️ red heart love;🧡 orange heart;💛 yellow heart;💚 green heart;💙 blue heart;💜 purple heart;🤎 brown heart;🖤 black heart;🤍 white heart;🩷 pink heart;🩵 light blue heart;🩶 grey heart;💯 hundred perfect;💢 anger;💥 boom explosion;💫 dizzy star;💦 sweat drops;💨 dash;💬 speech;💭 thought;💤 sleep"),
        EmojiGroup("People", "👋 wave hello;🤚 raised hand;🖐️ hand fingers;✋ stop hand;🖖 vulcan;🫱 right hand;🫲 left hand;👌 okay;🤌 pinch;🤏 small pinch;✌️ peace victory;🤞 luck crossed fingers;🫰 heart fingers;🤟 love gesture;🤘 rock horns;🤙 call;👈 left;👉 right;👆 up;👇 down;☝️ point;👍 thumbs up yes approve;👎 thumbs down no disapprove;✊ fist;👊 punch;🤛 fist left;🤜 fist right;👏 clap applause;🙌 celebrate hands;🫶 heart hands;👐 open hands;🤲 palms;🤝 handshake agreement;🙏 prayer thanks;💪 strong muscle;🦾 prosthetic arm;🦵 leg;🦶 foot;👂 ear;👃 nose;🧠 brain;🫀 heart organ;👀 eyes look;👁️ eye;👅 tongue;👄 mouth;👶 baby;🧒 child;👦 boy;👧 girl;🧑 person;👨 man;👩 woman;👴 old man;👵 old woman;🙍 frown person;🙎 pout;🙅 no gesture;🙆 okay gesture;💁 help;🙋 raise hand;🧏 deaf;🙇 bow;🤦 facepalm;🤷 shrug;👮 police;👷 construction;💂 guard;🧑‍⚕️ doctor;🧑‍🎓 student;🧑‍🏫 teacher;🧑‍💻 developer computer;🧑‍🍳 chef;🧑‍🚀 astronaut;🧙 wizard;🧚 fairy;🧛 vampire;🧜 mermaid;🧝 elf;🧟 zombie;💆 massage;💇 haircut;🚶 walk;🏃 run;💃 dance;🕺 dance;🧘 meditation;🛌 bed sleep"),
        EmojiGroup("Animals & nature", "🐶 dog;🐱 cat;🐭 mouse;🐹 hamster;🐰 rabbit;🦊 fox;🐻 bear;🐼 panda;🐨 koala;🐯 tiger;🦁 lion;🐮 cow;🐷 pig;🐸 frog;🐵 monkey;🙈 see monkey;🙉 hear monkey;🙊 speak monkey;🐔 chicken;🐧 penguin;🐦 bird;🐤 chick;🦆 duck;🦅 eagle;🦉 owl;🦇 bat;🐺 wolf;🐗 boar;🐴 horse;🦄 unicorn;🐝 bee;🪱 worm;🐛 bug;🦋 butterfly;🐌 snail;🐞 ladybug;🐜 ant;🕷️ spider;🦂 scorpion;🐢 turtle;🐍 snake;🦎 lizard;🐙 octopus;🦑 squid;🦐 shrimp;🦀 crab;🐠 fish;🐟 fish;🐬 dolphin;🐳 whale;🦈 shark;🐊 crocodile;🐘 elephant;🦒 giraffe;🦘 kangaroo;🦔 hedgehog;🌵 cactus;🎄 christmas tree;🌲 evergreen tree;🌳 tree;🌴 palm;🌱 seedling;🌿 herb;☘️ shamrock;🍀 luck clover;🍁 maple leaf;🍂 autumn leaves;🍃 wind leaf;🌺 hibiscus;🌻 sunflower;🌹 rose;🌷 tulip;🌸 blossom;🌼 flower;🌎 earth;🌍 earth africa;🌏 earth asia;🌕 moon;🌙 crescent;⭐ star;🌟 glow star;✨ sparkle;⚡ lightning;🔥 fire;🌈 rainbow;☀️ sun;☁️ cloud;🌧️ rain;❄️ snow;☃️ snowman;💧 water drop;🌊 wave"),
        EmojiGroup("Food & drink", "🍏 apple green;🍎 apple red;🍐 pear;🍊 orange;🍋 lemon;🍌 banana;🍉 watermelon;🍇 grapes;🍓 strawberry;🫐 blueberry;🍈 melon;🍒 cherry;🍑 peach;🥭 mango;🍍 pineapple;🥥 coconut;🥝 kiwi;🍅 tomato;🍆 eggplant;🥑 avocado;🥦 broccoli;🥬 greens;🥒 cucumber;🌶️ pepper;🌽 corn;🥕 carrot;🧄 garlic;🧅 onion;🥔 potato;🍠 sweet potato;🥐 croissant;🥯 bagel;🍞 bread;🥖 baguette;🥨 pretzel;🧀 cheese;🥚 egg;🍳 cooking breakfast;🥓 bacon;🥞 pancakes;🧇 waffle;🍔 burger;🍟 fries;🍕 pizza;🌭 hotdog;🥪 sandwich;🌮 taco;🌯 burrito;🥗 salad;🍝 pasta;🍜 noodles;🍲 stew;🍛 curry;🍣 sushi;🍱 bento;🥟 dumpling;🍤 shrimp;🍙 rice ball;🍚 rice;🍦 ice cream;🍧 shaved ice;🍨 ice cream;🍩 donut;🍪 cookie;🎂 birthday cake;🍰 cake;🧁 cupcake;🍫 chocolate;🍿 popcorn;🍬 candy;🍭 lollipop;🍯 honey;🥛 milk;☕ coffee tea;🫖 tea pot;🍵 tea;🧃 juice;🥤 drink soda;🧋 bubble tea;🍺 beer;🍻 cheers beer;🥂 toast champagne;🍷 wine;🍸 cocktail;🍹 tropical drink;🥃 whiskey;🍾 champagne;🍴 cutlery;🥄 spoon"),
        EmojiGroup("Activities", "⚽ soccer football;🏀 basketball;🏈 football;⚾ baseball;🥎 softball;🎾 tennis;🏐 volleyball;🏉 rugby;🥏 frisbee;🎱 pool;🏓 ping pong;🏸 badminton;🏒 hockey;🏑 hockey field;🥍 lacrosse;🏏 cricket;🥅 goal;⛳ golf;🏹 archery;🎣 fishing;🥊 boxing;🥋 martial arts;🎽 running;🛹 skateboard;🛼 roller skate;⛸️ ice skate;🎿 ski;🏂 snowboard;🏄 surf;🏊 swim;🚴 cycle;🏆 trophy;🥇 gold medal;🥈 silver medal;🥉 bronze medal;🏅 medal;🎖️ medal;🎗️ ribbon;🎫 ticket;🎟️ tickets;🎪 circus;🎭 theatre;🎨 art palette;🎬 movie;🎤 microphone sing;🎧 headphones;🎼 music score;🎹 piano;🥁 drum;🎷 saxophone;🎺 trumpet;🎸 guitar;🎻 violin;🎲 dice game;♟️ chess;🎯 target darts;🎳 bowling;🎮 game controller;🧩 puzzle;🎉 party celebration;🎊 confetti;🎈 balloon;🎁 gift"),
        EmojiGroup("Travel & places", "🚗 car;🚕 taxi;🚙 suv;🚌 bus;🚎 trolley;🏎️ racing;🚓 police car;🚑 ambulance;🚒 fire truck;🚐 van;🚚 truck;🚛 truck articulated;🚜 tractor;🛴 scooter;🚲 bicycle;🛵 scooter motor;🏍️ motorcycle;🚂 train;🚆 train;🚇 metro;🚊 tram;✈️ plane;🛫 departure;🛬 arrival;🚀 rocket;🛸 ufo;🚁 helicopter;⛵ sailboat;🚤 boat;🛳️ ship;⚓ anchor;⛽ fuel;🚦 traffic;🗺️ map;🗽 liberty;🗼 tokyo tower;🏰 castle;🏯 japanese castle;🎡 ferris wheel;🎢 roller coaster;⛲ fountain;🏖️ beach;🏝️ island;🏜️ desert;🌋 volcano;⛰️ mountain;🏕️ camp;🏠 house;🏡 garden house;🏢 office;🏥 hospital;🏦 bank;🏨 hotel;🏪 store;🏫 school;🏛️ classical building;⛪ church;🕌 mosque;🛕 temple;⛩️ shrine;🌅 sunrise;🌄 sunrise mountains;🌠 shooting star;🎆 fireworks;🌃 night city;🏙️ city;🌉 bridge"),
        EmojiGroup("Objects", "⌚ watch;📱 phone;💻 laptop computer;⌨️ keyboard;🖥️ desktop;🖨️ printer;🖱️ mouse computer;💾 floppy save;💿 cd;📷 camera;📸 photo;🎥 movie camera;📺 television;📻 radio;☎️ telephone;🔋 battery;🔌 plug;💡 light bulb idea;🔦 flashlight;🕯️ candle;🧯 fire extinguisher;💸 money;💰 money bag;💳 credit card;💎 diamond;⚖️ scales;🔧 wrench;🔨 hammer;🛠️ tools;⚙️ gear;🧱 brick;🔗 link;🧲 magnet;🔫 water pistol;💣 bomb;🔪 knife;🛡️ shield;🔑 key;🔒 lock;🔓 unlock;🔔 bell;🔕 muted bell;📚 books;📖 book read;📝 memo note;✏️ pencil;🖊️ pen;🖌️ paint brush;📌 pin;📍 location pin;📎 paperclip;✂️ scissors;📏 ruler;📐 triangle ruler;📅 calendar;📆 calendar tear;🗑️ trash;📦 package;✉️ envelope;📧 email;📬 mailbox;📁 folder;📂 open folder;📊 chart;📈 growth chart;📉 decline chart;🔍 search;🔎 search right;🧪 test science;🔬 microscope;🔭 telescope;💊 pill;💉 syringe;🩹 bandage;🧹 broom;🧺 basket;🧻 paper;🪣 bucket;🧼 soap;🪥 toothbrush;🛏️ bed;🛋️ sofa;🚪 door;🪞 mirror"),
        EmojiGroup("Symbols", "✅ check done;☑️ checkbox;✔️ check;❌ cross no;❎ cross box;➕ plus;➖ minus;➗ divide;✖️ multiply;♾️ infinity;❓ question;❔ question white;❗ exclamation;❕ exclamation white;‼️ double exclamation;⁉️ question exclamation;⚠️ warning;🚫 prohibited;⛔ no entry;🔴 red circle;🟠 orange circle;🟡 yellow circle;🟢 green circle;🔵 blue circle;🟣 purple circle;⚫ black circle;⚪ white circle;🟤 brown circle;🟥 red square;🟧 orange square;🟨 yellow square;🟩 green square;🟦 blue square;🟪 purple square;⬛ black square;⬜ white square;🔶 orange diamond;🔷 blue diamond;🔺 triangle up;🔻 triangle down;💠 diamond;🔘 radio button;🔳 square;🔲 square outline;⬆️ up arrow;⬇️ down arrow;⬅️ left arrow;➡️ right arrow;↗️ northeast;↘️ southeast;↙️ southwest;↖️ northwest;↔️ horizontal;↕️ vertical;🔄 refresh;🔃 clockwise;▶️ play;⏸️ pause;⏹️ stop;⏩ forward;⏪ rewind;🔀 shuffle;🔁 repeat;🔂 repeat one;🎵 music note;🎶 music notes;🔊 loud sound;🔇 mute;📣 megaphone;📢 speaker;♻️ recycle;⚜️ fleur de lis;🔱 trident;📛 name badge;🔰 beginner;🆕 new;🆓 free;🆗 okay;🆒 cool;🆘 help sos;💤 sleep;🏧 atm;🚻 restroom;♿ wheelchair accessibility"),
        EmojiGroup("Flags", "🏁 racing checkered flag;🚩 red flag;🎌 crossed flags;🏴 black flag;🏳️ white flag;🏳️‍🌈 rainbow pride flag;🏳️‍⚧️ transgender flag;🏴‍☠️ pirate flag;🇸🇬 singapore flag;🇺🇸 united states america flag;🇬🇧 united kingdom britain flag;🇨🇦 canada flag;🇦🇺 australia flag;🇳🇿 new zealand flag;🇵🇭 philippines flag;🇲🇾 malaysia flag;🇮🇩 indonesia flag;🇹🇭 thailand flag;🇻🇳 vietnam flag;🇮🇳 india flag;🇨🇳 china flag;🇯🇵 japan flag;🇰🇷 south korea flag;🇹🇼 taiwan flag;🇭🇰 hong kong flag;🇫🇷 france flag;🇩🇪 germany flag;🇮🇹 italy flag;🇪🇸 spain flag;🇵🇹 portugal flag;🇳🇱 netherlands flag;🇧🇪 belgium flag;🇨🇭 switzerland flag;🇸🇪 sweden flag;🇳🇴 norway flag;🇩🇰 denmark flag;🇫🇮 finland flag;🇮🇪 ireland flag;🇵🇱 poland flag;🇺🇦 ukraine flag;🇬🇷 greece flag;🇹🇷 turkey flag;🇧🇷 brazil flag;🇲🇽 mexico flag;🇦🇷 argentina flag;🇿🇦 south africa flag;🇦🇪 united arab emirates flag;🇸🇦 saudi arabia flag;🇮🇱 israel flag;🇪🇬 egypt flag;🇪🇺 european union flag")
    ]
}
