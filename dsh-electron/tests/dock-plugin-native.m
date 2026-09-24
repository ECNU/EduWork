#import <AppKit/AppKit.h>
#include <assert.h>

@interface TestTile : NSObject
@property(nonatomic, strong) NSView *contentView;
@property(nonatomic) NSUInteger displays;
@end
@implementation TestTile
- (NSSize)size { return NSMakeSize(128, 128); }
- (void)display { self.displays++; }
@end

@interface TestApplication : NSObject
@property(nonatomic, copy) NSString *bundleIdentifier;
@end
@implementation TestApplication
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        assert(argc == 3);
        NSBundle *app = [NSBundle bundleWithPath:@(argv[1])];
        NSBundle *bundle = [NSBundle bundleWithPath:[app.bundlePath stringByAppendingPathComponent:@"Contents/PlugIns/EduWorkDockTilePlugin.docktileplugin"]];
        assert([bundle load]);
        id<NSDockTilePlugIn> plugin = [[bundle principalClass] new];
        TestTile *tile = [TestTile new];
        NSString *preference = @(argv[2]);
        void (^save)(NSString *) = ^(NSString *value) {
            assert([value writeToFile:preference atomically:YES encoding:NSUTF8StringEncoding error:NULL]);
        };
        void (^expect)(NSString *) = ^(NSString *color) {
            NSImage *expected = [[NSImage alloc] initWithContentsOfFile:[app.resourcePath stringByAppendingFormat:@"/brand/dock-%@-1024.png", color]];
            assert([((NSImageView *)tile.contentView).image.TIFFRepresentation isEqual:expected.TIFFRepresentation]);
        };
        TestApplication *application = [TestApplication new];
        application.bundleIdentifier = app.bundleIdentifier;
        void (^terminate)(void) = ^{
            [NSWorkspace.sharedWorkspace.notificationCenter postNotificationName:NSWorkspaceDidTerminateApplicationNotification object:nil userInfo:@{NSWorkspaceApplicationKey: application}];
        };
        [plugin setDockTile:(NSDockTile *)tile];
        expect(@"red"); // No preference yet.
        save(@"{\"style\":\"dsh\"}"); terminate(); expect(@"blue");
        save(@"{\"style\":\"ecnu-liwa\"}"); terminate(); expect(@"red");
        save(@"{\"style\":\"dsh\"}");
        application.bundleIdentifier = @"org.example.unrelated";
        terminate(); expect(@"red");
        application.bundleIdentifier = app.bundleIdentifier;
        terminate(); expect(@"blue");
        [plugin setDockTile:nil];
        NSUInteger count = tile.displays;
        save(@"{\"style\":\"ecnu-liwa\"}"); terminate();
        assert(tile.displays == count);
        [plugin setDockTile:(NSDockTile *)tile]; expect(@"red");
        for (NSString *value in @[@"{broken", @"[]", @"null", @"{\"style\":\"../../invalid\"}"]) {
            save(value); terminate(); expect(@"red");
        }
        save(@"{\"style\":\"dsh\"}");
        [plugin setDockTile:nil];
        plugin = [[bundle principalClass] new];
        [plugin setDockTile:(NSDockTile *)tile]; expect(@"blue");
        [plugin setDockTile:nil];
        puts("PASS: native Dock plugin startup, red/blue exit refresh, unrelated apps, atomic preference replacement, reload, invalid preferences and detach");
    }
}
